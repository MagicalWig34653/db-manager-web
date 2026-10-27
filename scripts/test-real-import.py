#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""W-P12/W-P13: run the production web UI (import, multi row actions, file values, foreign key lookup) against a real
Go backend with a throwaway SQLite database and a throwaway PostgreSQL container (TLS verify-full).

Backend source: DBM_BACKEND_REPO/DBM_BACKEND_REV (local checkout exported with git archive, e.g. REV=d9463ba) or the
public commit pinned in src/lib/contract/v19/provenance.json. All ports are chosen free at run time (never a fixed
port); the container, processes, credentials and checkout are task-owned and removed afterwards. MySQL/MariaDB are not
covered here."""
import hashlib, importlib.util, json, os, secrets, signal, subprocess, sys, tarfile, tempfile, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('real_tables', ROOT / 'scripts/test-real-tables.py')
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
run, wait, port, api, redact = base.run, base.wait, base.port, base.api, base.redact
PINS = {n: json.loads((ROOT / f'src/lib/contract/v{n}/provenance.json').read_text()) for n in (18, 19)}

def fetch_backend(source: Path):
    repo = os.environ.get('DBM_BACKEND_REPO')
    if repo:
        sha = run(['git', '-C', repo, 'rev-parse', os.environ.get('DBM_BACKEND_REV', 'HEAD')])
        archive = source.parent / 'backend.tar'
        run(['git', '-C', repo, 'archive', '--format=tar', '-o', str(archive), sha])
        with tarfile.open(archive) as tar: tar.extractall(source, filter='data')
        return sha
    pin = PINS[19]
    run(['git', 'init', '--initial-branch=fixture', str(source)])
    run(['git', '-C', str(source), 'remote', 'add', 'origin', pin['source'] + '.git'])
    run(['git', '-C', str(source), 'fetch', '--depth=1', 'origin', pin['source_commit']])
    run(['git', '-C', str(source), 'checkout', '--detach', 'FETCH_HEAD'])
    return run(['git', '-C', str(source), 'rev-parse', 'HEAD'])

def main():
    token = secrets.token_urlsafe(48); password = secrets.token_urlsafe(32)
    base.HIDDEN.extend([token, password])
    prefix = 'dbmanager-wp1213-' + secrets.token_hex(6)
    parent = ROOT / 'node_modules/.cache'; parent.mkdir(parents=True, exist_ok=True)
    processes = []; logs = []; created = False
    run(['npm', 'run', 'build'], cwd=ROOT)
    with tempfile.TemporaryDirectory(prefix=prefix + '-', dir=parent) as temp:
        directory = Path(temp); source = directory / 'backend'; source.mkdir()
        try:
            sha = fetch_backend(source)
            for n, pin in PINS.items():
                assert hashlib.sha256((source / f'contracts/api-v0.{n}.0.json').read_bytes()).hexdigest() == pin['sha256'], f'v{n} bytes differ from the vendored copy'
            print('W-P12/13 backend revision', sha, '- contracts 0.18.0 and 0.19.0 bytes verified; building Go CLI.', flush=True)
            binary = directory / 'db-manager'; run(['go', 'build', '-trimpath', '-o', str(binary), './cmd/db-manager'], cwd=source)
            tls = directory / 'tls'; tls.mkdir()
            run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=DB Manager W12 Fixture CA', '-keyout', str(tls / 'ca.key'), '-out', str(tls / 'ca.pem')])
            run(['openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', str(tls / 'server.key'), '-out', str(tls / 'server.csr')])
            (tls / 'extensions').write_text('subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n')
            run(['openssl', 'x509', '-req', '-days', '1', '-in', str(tls / 'server.csr'), '-CA', str(tls / 'ca.pem'), '-CAkey', str(tls / 'ca.key'), '-CAcreateserial', '-extfile', str(tls / 'extensions'), '-out', str(tls / 'server.pem')])
            envfile = directory / 'pg.env'; envfile.write_text('POSTGRES_PASSWORD=' + password + '\nPOSTGRES_DB=w12_probe\n'); envfile.chmod(0o600)
            command = 'chown -R postgres /fixture && chmod 600 /fixture/server.key && exec /usr/local/bin/docker-entrypoint.sh "$@"'
            run(['docker', 'create', '--name', prefix, '--label', 'dbmanager.task=W12-13', '-p', '127.0.0.1::5432', '--env-file', str(envfile), '--entrypoint', 'sh', 'postgres:18.6-alpine', '-c', command, 'fixture', 'postgres', '-c', 'ssl=on', '-c', 'ssl_cert_file=/fixture/server.pem', '-c', 'ssl_key_file=/fixture/server.key']); created = True
            run(['docker', 'cp', str(tls), prefix + ':/fixture'])
            run(['docker', 'start', prefix])
            # The official image first runs a socket-only bootstrap server; only the final server answers on TCP.
            wait(lambda: 'accepting connections' in run(['docker', 'exec', prefix, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'w12_probe']), 'final PostgreSQL TCP readiness')
            pgport = int(json.loads(run(['docker', 'inspect', '--format', '{{json .NetworkSettings.Ports}}', prefix]))['5432/tcp'][0]['HostPort'])
            tokenfile = directory / 'token'; tokenfile.write_text(token + '\n'); tokenfile.chmod(0o600)
            backendport = port(); backend = f'http://127.0.0.1:{backendport}'
            environment = dict(os.environ, DBM_TOKEN_FILE=str(tokenfile), DBM_DATA_DIR=str(directory / 'data'), DBM_ADDRESS=f'127.0.0.1:{backendport}', DBM_ALLOWED_HOSTS='localhost,127.0.0.1', DBM_DB_CA_FILE=str(tls / 'ca.pem'))
            log = (directory / 'go.log').open('w'); logs.append(log)
            processes.append(subprocess.Popen([str(binary)], env=environment, stdout=log, stderr=log))
            wait(lambda: api(backend, '/healthz')['status'] == 'ok', 'Go server')
            pg = {'driver': 'postgres', 'host': 'localhost', 'port': pgport, 'username': 'postgres', 'password': password, 'database': 'w12_probe', 'tls_mode': 'verify-full'}
            api(backend, '/api/v1/connections/test', token, {'connection': pg})
            for path, feature in (('/api/v18/capabilities', 'import'), ('/api/v19/capabilities', 'rows-bulk')):
                caps = api(backend, path, token)
                assert caps['available'] is True, (feature, caps)
            webport = port(); webbase = f'http://127.0.0.1:{webport}'
            log = (directory / 'web.log').open('w'); logs.append(log)
            processes.append(subprocess.Popen(['npm', 'run', 'preview', '--', '--port', str(webport), '--strictPort'], cwd=ROOT, env=dict(os.environ, DB_MANAGER_BACKEND_URL=backend), stdout=log, stderr=log, start_new_session=True))
            wait(lambda: urllib.request.urlopen(webbase, timeout=2).status == 200, 'web preview')
            config = directory / 'config.json'
            config.write_text(json.dumps({'baseURL': webbase, 'outputDir': str(directory / 'results'), 'token': token, 'password': password, 'postgresPort': pgport, 'backendURL': backend})); config.chmod(0o600)
            environment = dict(os.environ, DBM_REAL_CONFIG=str(config), CI='1')
            run(['npx', 'playwright', 'install', 'chromium'], cwd=ROOT, env=environment)
            print(redact(run(['npx', 'playwright', 'test', '--config', 'playwright.real.config.ts', '--reporter=line', 'tests/real/import-bulk.spec.ts'], cwd=ROOT, env=environment)), flush=True)
            print('W-P12/13 real: SQLite and PostgreSQL CSV import (preview, one-time plan, failing replay), SQL import, multi row update/conflict/copy/delete, file value and read-back passed.', flush=True)
        finally:
            for process in reversed(processes):
                if process.poll() is None:
                    if process.args[0] == 'npm': os.killpg(process.pid, signal.SIGTERM)
                    else: process.terminate()
                    process.wait(timeout=15)
            for log in logs: log.close()
            if created: run(['docker', 'rm', '-fv', prefix])
    print('W-P12/13 task-owned processes, database container/volume, credentials and temporary checkout removed.', flush=True)

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(redact(error), file=sys.stderr); sys.exit(1)
