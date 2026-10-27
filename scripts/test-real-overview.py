#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Run the production web UI against a real Go backend (API 0.7) with SQLite and PostgreSQL (TLS verify-full).

The backend source comes from a local checkout given by DBM_BACKEND_REPO (a git repository containing
contracts/api-v0.7.0.json). DBM_BACKEND_REV (default: HEAD) selects the commit; it is exported with
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
PIN = json.loads((ROOT / 'src/lib/contract/v7/provenance.json').read_text())
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


def main():
    repo = os.environ.get('DBM_BACKEND_REPO')
    if not repo:
        raise RuntimeError('Set DBM_BACKEND_REPO to a checkout of the Go backend repository.')
    rev = os.environ.get('DBM_BACKEND_REV', 'HEAD')
    prefix = 'dbmanager-w-p06-web-' + secrets.token_hex(6)
    token = secrets.token_urlsafe(48)
    password = secrets.token_urlsafe(32)
    HIDDEN.extend([token, password])
    parent = ROOT / 'node_modules/.cache'
    parent.mkdir(parents=True, exist_ok=True)
    created = False
    processes = []
    logs = []
    if os.environ.get('DBM_EMBEDDED') != '1': run(['npm', 'run', 'build'], cwd=ROOT)
    with tempfile.TemporaryDirectory(prefix=prefix + '-', dir=parent) as temp:
        directory = Path(temp)
        source = directory / 'backend'
        source.mkdir()
        try:
            archive = subprocess.run(['git', '-C', repo, 'archive', rev], capture_output=True)
            if archive.returncode:
                raise RuntimeError('git archive failed for the backend revision')
            subprocess.run(['tar', '-x', '-C', str(source)], input=archive.stdout, check=True)
            contract = (source / 'contracts/api-v0.7.0.json').read_bytes()
            assert hashlib.sha256(contract).hexdigest() == PIN['sha256'], 'backend contract differs from the vendored v7'
            assert contract == (ROOT / 'src/lib/contract/v7/api-v0.7.0.json').read_bytes()
            print('W-P06 real: backend revision exports the exact vendored v7 contract; building native Go CLI.', flush=True)
            binary = directory / 'db-manager'
            run(['go', 'build', '-trimpath', '-o', str(binary), './cmd/db-manager'], cwd=source)
            tls = directory / 'tls'
            tls.mkdir()
            run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=DB Manager W-P06 Fixture CA', '-keyout', str(tls / 'ca.key'), '-out', str(tls / 'ca.pem')])
            run(['openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', str(tls / 'server.key'), '-out', str(tls / 'server.csr')])
            (tls / 'extensions').write_text('subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n')
            run(['openssl', 'x509', '-req', '-days', '1', '-in', str(tls / 'server.csr'), '-CA', str(tls / 'ca.pem'), '-CAkey', str(tls / 'ca.key'), '-CAcreateserial', '-extfile', str(tls / 'extensions'), '-out', str(tls / 'server.pem')])
            envfile = directory / 'pg.env'
            envfile.write_text('POSTGRES_PASSWORD=' + password + '\nPOSTGRES_DB=p06_probe\n')
            envfile.chmod(0o600)
            command = 'chown -R postgres /fixture && chmod 600 /fixture/server.key && exec /usr/local/bin/docker-entrypoint.sh "$@"'
            run(['docker', 'create', '--name', prefix, '--label', 'dbmanager.task=W-P06-web', '-p', '127.0.0.1::5432', '--env-file', str(envfile), '--entrypoint', 'sh', 'postgres:18.6-alpine', '-c', command, 'fixture', 'postgres', '-c', 'ssl=on', '-c', 'ssl_cert_file=/fixture/server.pem', '-c', 'ssl_key_file=/fixture/server.key'])
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
            pg = {'driver': 'postgres', 'host': 'localhost', 'port': pgport, 'username': 'postgres', 'password': password, 'database': 'p06_probe', 'tls_mode': 'verify-full'}
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
            capabilities = api(base, '/api/v7/capabilities', token)
            assert capabilities['contract_version'] == '0.7.0'
            for driver, connection in [('sqlite', {'driver': 'sqlite', 'database': 'p06_fixture'}), ('postgres', pg)]:
                def query(sql, driver=driver, connection=connection):
                    try:
                        return api(base, '/api/v1/query', token, {'connection': connection, 'sql': sql})
                    except RuntimeError as error:
                        raise RuntimeError(f'W-P06 synthetic {driver} fixture: {error}') from None
                print(f'W-P06 real: setting up synthetic {driver} objects.', flush=True)
                query('CREATE TABLE "odd""name" (id INTEGER PRIMARY KEY, v TEXT)')
                query('INSERT INTO "odd""name"(id, v) VALUES (1,\'a\'),(2,\'b\'),(3,\'c\')')
                query('CREATE TABLE t_a (id INTEGER PRIMARY KEY, v TEXT)')
                if driver == 'sqlite':
                    query('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<1000) INSERT INTO t_a(id, v) SELECT x, \'row\' FROM c')
                else:
                    query("INSERT INTO t_a(id, v) SELECT g, 'row' FROM generate_series(1,1000) AS g")
                    query('ANALYZE t_a')
                query('CREATE VIEW v_a AS SELECT id FROM t_a')
                info = api(base, '/api/v7/server-info', token, {'connection': connection})
                assert info['driver'] == driver and 'password' not in json.dumps(info).lower()
            webport = port()
            webbase = f'http://127.0.0.1:{webport}'
            environment = dict(os.environ, DB_MANAGER_BACKEND_URL=base)
            log = (directory / 'web.log').open('w')
            logs.append(log)
            processes.append(subprocess.Popen((['node', 'scripts/embedded-proxy.mjs', str(webport)] if os.environ.get('DBM_EMBEDDED') == '1' else ['npm', 'run', 'preview', '--', '--port', str(webport), '--strictPort']), cwd=ROOT, env=environment, stdout=log, stderr=log, start_new_session=True))
            wait(lambda: urllib.request.urlopen(webbase, timeout=2).status == 200, 'production web preview with real same-origin API proxy')
            config = directory / 'config.json'
            config.write_text(json.dumps({'baseURL': webbase, 'token': token, 'password': password, 'postgresPort': pgport, 'backendURL': base, 'outputDir': str(directory / 'results')}))
            config.chmod(0o600)
            environment = dict(os.environ, DBM_REAL_CONFIG=str(config), CI='1')
            run(['npx', 'playwright', 'install', 'chromium'], cwd=ROOT, env=environment)
            print(redact(run(['npx', 'playwright', 'test', '--config', 'playwright.real.config.ts', '--reporter=line', 'tests/real/overview.spec.ts'], cwd=ROOT, env=environment)), flush=True)
            print('W-P06 real: SQLite and PostgreSQL (verify-full) overview, exact count and definition checks passed.', flush=True)
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
    print('W-P06 task-owned processes, database container/volume, private credentials and temporary export removed.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(redact(error), file=sys.stderr)
        sys.exit(1)
