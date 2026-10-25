#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Run the production web UI export wizard against a real Go backend (API 0.11) with SQLite and PostgreSQL (TLS verify-full).
The downloaded dumps are restored with independent clients (sqlite3 module, psql) into fresh databases and compared.

The backend source comes from a local checkout given by DBM_BACKEND_REPO (a git repository containing
contracts/api-v0.11.0.json). DBM_BACKEND_REV (default: HEAD) selects the commit; it is exported with
`git archive`, so uncommitted changes are never built. MySQL and MariaDB are covered by the backend suite.
"""
import hashlib
import json
import os
import re
import secrets
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PIN = json.loads((ROOT / 'src/lib/contract/v11/provenance.json').read_text())
HIDDEN = []


def redact(value):
    value = str(value).replace(str(ROOT), '<web-checkout>').replace(str(Path.home()), '<home>')
    for secret in HIDDEN:
        value = value.replace(secret, '<redacted>')
    return value


def run(args, **kwargs):
    result = subprocess.run(args, text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(redact(f'{args[0]} failed ({result.returncode}):\n{result.stdout}\n{result.stderr}'))
    return result.stdout.strip()


def wait(check, label):
    for _ in range(120):
        try:
            if check():
                return
        except (OSError, ValueError, RuntimeError, urllib.error.URLError):
            pass
        time.sleep(.5)
    raise RuntimeError('Timed out: ' + label)


def port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def api(base, path, token=None, body=None, expected=200):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
    try:
        response = urllib.request.urlopen(request, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        if response.status != expected:
            try:
                code = json.load(response).get('error', {}).get('code', 'unknown')
            except (ValueError, AttributeError):
                code = 'unknown'
            if not isinstance(code, str) or not re.fullmatch('[a-z_]{1,64}', code):
                code = 'unknown'
            raise RuntimeError(f'{path}: HTTP {response.status}, expected {expected}; public code={code}')
        return json.load(response)


CANON = {
    'sqlite': 'SELECT quote(id), quote(v), quote(n), quote(b) FROM "odd""name" ORDER BY id',
    'postgres': "SELECT id::text, replace(quote_nullable(v), chr(10), '~LF~'), quote_nullable(n::text), coalesce(encode(b,'hex'),'NULL') FROM \"odd\"\"name\" ORDER BY id",
}


def canon_source(base, token, connection, driver):
    result = api(base, '/api/v1/query', token, {'connection': connection, 'sql': CANON[driver]})['results'][0]
    return [[cell.get('value', 'NULL') if cell['kind'] != 'null' else 'NULL' for cell in row] for row in result['rows']]


def check_dumps(dumps, base, token, sources, prefix):
    import csv, gzip, io, sqlite3
    marker = b'-- DBMANAGER EXPORT COMPLETE\n'
    for driver, label in [('sqlite', 'sqlite'), ('postgres', 'postgresql')]:
        sql = (dumps / f'{label}-sql-export.sql').read_bytes()
        assert sql.endswith(b'\n' + marker), f'{label}: dump lacks the closing marker'
        gz = gzip.decompress((dumps / f'{label}-sqlgz-export.sql.gz').read_bytes())
        assert gz == sql, f'{label}: gzip dump differs from plain dump'
        document = json.loads((dumps / f'{label}-json-export.json').read_text(encoding='utf-8'))
        assert document['complete'] is True and document['format'] == 'dbmanager-export'
        rows = {t['table']['name']: t['rows'] for t in document['tables']}
        assert len(rows['t_big']) == 1000 and len(rows['odd"name']) == 4, f'{label}: JSON row counts'
        table = next(t for t in document['tables'] if t['table']['name'] == 'odd"name')
        assert all(len(r) == len(table['columns']) for r in table['rows'])
        text = (dumps / f'{label}-csv-export.csv').read_text(encoding='utf-8-sig')
        records = list(csv.reader(io.StringIO(text, newline='')))
        assert records[-1][0] == 'complete' and len(records) == 1 + 4 + 1, f'{label}: CSV records'
        assert not list(dumps.glob(f'{label}-cut-*')), f'{label}: an incomplete export was saved'
        expected = canon_source(base, token, sources[driver], driver)
        assert len(expected) == 4
        if driver == 'sqlite':
            restored = sqlite3.connect(':memory:')
            restored.executescript(sql.decode('utf-8'))
            actual = [[str(c) for c in r] for r in restored.execute(CANON['sqlite']).fetchall()]
            assert restored.execute('SELECT count(*) FROM t_big').fetchone()[0] == 1000
        else:
            def psql(database, statement, stdin=None):
                return run(['docker', 'exec', '-i', prefix, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At', '-F', '\x1f', '-c', statement] if stdin is None else ['docker', 'exec', '-i', prefix, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q'], **({} if stdin is None else {'input': stdin}))
            psql('postgres', 'CREATE DATABASE p11_restore')
            psql('p11_restore', None, stdin=sql.decode('utf-8'))
            actual = [line.split('\x1f') for line in psql('p11_restore', CANON['postgres']).split('\n')]
            assert psql('p11_restore', 'SELECT count(*) FROM t_big') == '1000'
        assert actual == expected, f'{label}: restored rows differ\n{actual}\n{expected}'
        print(f'W-P11 real: {label} dump restored into a fresh database and compared; JSON/CSV/GZip verified.', flush=True)


def main():
    repo = os.environ.get('DBM_BACKEND_REPO')
    if not repo:
        raise RuntimeError('Set DBM_BACKEND_REPO to a checkout of the Go backend repository.')
    rev = os.environ.get('DBM_BACKEND_REV', 'HEAD')
    prefix = 'dbmanager-w-p11-web-' + secrets.token_hex(6)
    token = secrets.token_urlsafe(48)
    password = secrets.token_urlsafe(32)
    HIDDEN.extend([token, password])
    parent = ROOT / 'node_modules/.cache'
    parent.mkdir(parents=True, exist_ok=True)
    created = False
    processes = []
    logs = []
    run(['npm', 'run', 'build'], cwd=ROOT)
    with tempfile.TemporaryDirectory(prefix=prefix + '-', dir=parent) as temp:
        directory = Path(temp)
        source = directory / 'backend'
        source.mkdir()
        try:
            archive = subprocess.run(['git', '-C', repo, 'archive', rev], capture_output=True)
            if archive.returncode:
                raise RuntimeError('git archive failed for the backend revision')
            subprocess.run(['tar', '-x', '-C', str(source)], input=archive.stdout, check=True)
            contract = (source / 'contracts/api-v0.11.0.json').read_bytes()
            assert hashlib.sha256(contract).hexdigest() == PIN['sha256'], 'backend contract differs from the vendored v11'
            assert contract == (ROOT / 'src/lib/contract/v11/api-v0.11.0.json').read_bytes()
            print('W-P11 real: backend revision exports the exact vendored v11 contract; building native Go CLI.', flush=True)
            binary = directory / 'db-manager'
            run(['go', 'build', '-trimpath', '-o', str(binary), './cmd/db-manager'], cwd=source)
            tls = directory / 'tls'
            tls.mkdir()
            run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=DB Manager W-P11 Fixture CA', '-keyout', str(tls / 'ca.key'), '-out', str(tls / 'ca.pem')])
            run(['openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', str(tls / 'server.key'), '-out', str(tls / 'server.csr')])
            (tls / 'extensions').write_text('subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n')
            run(['openssl', 'x509', '-req', '-days', '1', '-in', str(tls / 'server.csr'), '-CA', str(tls / 'ca.pem'), '-CAkey', str(tls / 'ca.key'), '-CAcreateserial', '-extfile', str(tls / 'extensions'), '-out', str(tls / 'server.pem')])
            envfile = directory / 'pg.env'
            envfile.write_text('POSTGRES_PASSWORD=' + password + '\nPOSTGRES_DB=p11_probe\n')
            envfile.chmod(0o600)
            command = 'chown -R postgres /fixture && chmod 600 /fixture/server.key && exec /usr/local/bin/docker-entrypoint.sh "$@"'
            run(['docker', 'create', '--name', prefix, '--label', 'dbmanager.task=W-P11-web', '-p', '127.0.0.1::5432', '--env-file', str(envfile), '--entrypoint', 'sh', 'postgres:18.6-alpine', '-c', command, 'fixture', 'postgres', '-c', 'ssl=on', '-c', 'ssl_cert_file=/fixture/server.pem', '-c', 'ssl_key_file=/fixture/server.key'])
            created = True
            run(['docker', 'cp', str(tls), prefix + ':/fixture'])
            run(['docker', 'start', prefix])
            pgport = int(json.loads(run(['docker', 'inspect', '--format', '{{json .NetworkSettings.Ports}}', prefix]))['5432/tcp'][0]['HostPort'])
            tokenfile = directory / 'token'
            tokenfile.write_text(token + '\n')
            tokenfile.chmod(0o600)
            backendport = port()
            base = f'http://127.0.0.1:{backendport}'
            environment = dict(os.environ, DBM_TOKEN_FILE=str(tokenfile), DBM_DATA_DIR=str(directory / 'data'), DBM_ADDRESS=f'127.0.0.1:{backendport}', DBM_ALLOWED_HOSTS='localhost,127.0.0.1', DBM_DB_CA_FILE=str(tls / 'ca.pem'))
            log = (directory / 'go.log').open('w')
            logs.append(log)
            processes.append(subprocess.Popen([str(binary)], env=environment, stdout=log, stderr=log))
            wait(lambda: api(base, '/healthz')['status'] == 'ok', 'real Go server')
            pg = {'driver': 'postgres', 'host': 'localhost', 'port': pgport, 'username': 'postgres', 'password': password, 'database': 'p11_probe', 'tls_mode': 'verify-full'}
            # The official image restarts PostgreSQL after bootstrap; require a stable verify-full connection.
            stable = {'count': 0}

            def ready():
                try:
                    api(base, '/api/v1/connections/test', token, {'connection': pg})
                    stable['count'] += 1
                except (RuntimeError, OSError, urllib.error.URLError):
                    stable['count'] = 0
                    return False
                return stable['count'] >= 4
            wait(ready, 'stable PostgreSQL verify-full connection')
            capabilities = api(base, '/api/v11/capabilities', token)
            assert capabilities['contract_version'] == '0.11.0'
            sources = {}
            for driver, connection in [('sqlite', {'driver': 'sqlite', 'database': 'p11_src'}), ('postgres', pg)]:
                sources[driver] = connection
                def query(sql, connection=connection, driver=driver):
                    try:
                        return api(base, '/api/v1/query', token, {'connection': connection, 'sql': sql})
                    except RuntimeError as error:
                        raise RuntimeError(f'W-P11 synthetic {driver} fixture: {error}') from None
                print(f'W-P11 real: setting up synthetic {driver} data.', flush=True)
                if driver == 'sqlite':
                    query('CREATE TABLE "odd""name" (id INTEGER PRIMARY KEY, v TEXT, n TEXT, b BLOB)')
                    blob = "X'00FF'"
                    query('CREATE TABLE t_big (id INTEGER PRIMARY KEY, v TEXT)')
                    query('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<1000) INSERT INTO t_big(id, v) SELECT x, \'row\' || x FROM c')
                else:
                    query('CREATE TABLE "odd""name" (id BIGINT PRIMARY KEY, v TEXT, n NUMERIC(40,20), b BYTEA)')
                    blob = "decode('00ff','hex')"
                    query('CREATE TABLE t_big (id BIGINT PRIMARY KEY, v TEXT)')
                    query("INSERT INTO t_big(id, v) SELECT g, 'row' || g FROM generate_series(1,1000) AS g")
                query(f"INSERT INTO \"odd\"\"name\"(id, v, n, b) VALUES (1,'Grüße ''雪'', \"x\"\nzeile2 \\ backslash','12345678901234567890.12345678901234567890',{blob}), (2,NULL,NULL,NULL), (3,'',NULL,{blob}), (9007199254740993,'-- DBMANAGER EXPORT COMPLETE','0.5',NULL)")
            webport = port()
            webbase = f'http://127.0.0.1:{webport}'
            environment = dict(os.environ, DB_MANAGER_BACKEND_URL=base)
            log = (directory / 'web.log').open('w')
            logs.append(log)
            processes.append(subprocess.Popen(['npm', 'run', 'preview', '--', '--port', str(webport), '--strictPort'], cwd=ROOT, env=environment, stdout=log, stderr=log, start_new_session=True))
            wait(lambda: urllib.request.urlopen(webbase, timeout=2).status == 200, 'production web preview with real same-origin API proxy')
            config = directory / 'config.json'
            config.write_text(json.dumps({'baseURL': webbase, 'token': token, 'password': password, 'postgresPort': pgport, 'backendURL': base, 'outputDir': str(directory / 'results'), 'dumpDir': str(directory / 'dumps')}))
            config.chmod(0o600)
            environment = dict(os.environ, DBM_REAL_CONFIG=str(config), CI='1')
            run(['npx', 'playwright', 'install', 'chromium'], cwd=ROOT, env=environment)
            print(redact(run(['npx', 'playwright', 'test', '--config', 'playwright.real.config.ts', '--reporter=line', 'tests/real/export-wizard.spec.ts'], cwd=ROOT, env=environment)), flush=True)
            check_dumps(directory / 'dumps', base, token, sources, prefix)
            print('W-P11 real: SQLite and PostgreSQL (verify-full) export wizard, closing-marker, restore and comparison checks passed.', flush=True)
        finally:
            for process in reversed(processes):
                if process.poll() is None:
                    if process.args[0] == 'npm':
                        os.killpg(process.pid, signal.SIGTERM)
                    else:
                        process.terminate()
                    process.wait(timeout=15)
            for log in logs:
                log.close()
            if created:
                run(['docker', 'rm', '-fv', prefix])
    print('W-P11 task-owned processes, database container/volume, private credentials and temporary export removed.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(type(error).__name__ + ": " + redact(error), file=sys.stderr)
        sys.exit(1)
