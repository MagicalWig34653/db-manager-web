#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""W-P16: run the production web UI (CodeMirror SQL editor) against a real Go backend with throwaway
SQLite and PostgreSQL 18.6 (TLS verify-full). Backend source: DBM_BACKEND_REPO/DBM_BACKEND_REV
(local checkout, default revision HEAD) or, without them, the public commit pinned in
src/lib/contract/v12/provenance.json."""
import hashlib, importlib.util, json, os, secrets, subprocess, sys, tarfile, tempfile, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('real_tables', ROOT / 'scripts/test-real-tables.py')
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
run, wait, port, api, redact = base.run, base.wait, base.port, base.api, base.redact
PIN = json.loads((ROOT / 'src/lib/contract/v12/provenance.json').read_text())

def fetch_backend(source: Path):
    repo = os.environ.get('DBM_BACKEND_REPO')
    if repo:
        rev = os.environ.get('DBM_BACKEND_REV', 'HEAD')
        sha = run(['git', '-C', repo, 'rev-parse', rev])
        archive = source.parent / 'backend.tar'
        run(['git', '-C', repo, 'archive', '--format=tar', '-o', str(archive), sha])
        with tarfile.open(archive) as tar: tar.extractall(source, filter='data')
        return sha
    run(['git', 'init', '--initial-branch=fixture', str(source)])
    run(['git', '-C', str(source), 'remote', 'add', 'origin', PIN['source'] + '.git'])
    run(['git', '-C', str(source), 'fetch', '--depth=1', 'origin', PIN['source_commit']])
    run(['git', '-C', str(source), 'checkout', '--detach', 'FETCH_HEAD'])
    return run(['git', '-C', str(source), 'rev-parse', 'HEAD'])

def main():
    prefix = 'dbmanager-wp16-' + secrets.token_hex(6)
    token = secrets.token_urlsafe(48); password = secrets.token_urlsafe(32); invalid = secrets.token_urlsafe(48)
    base.HIDDEN.extend([token, password, invalid])
    parent = ROOT / 'node_modules/.cache'; parent.mkdir(parents=True, exist_ok=True)
    created = False; processes = []; logs = []
    if os.environ.get('DBM_EMBEDDED') != '1': run(['npm', 'run', 'build'], cwd=ROOT)
    with tempfile.TemporaryDirectory(prefix=prefix + '-', dir=parent) as temp:
        directory = Path(temp); source = directory / 'backend'; source.mkdir()
        try:
            sha = fetch_backend(source)
            assert hashlib.sha256((source / PIN['source_path']).read_bytes()).hexdigest() == PIN['sha256']
            print('W-P16 backend revision', sha, '- contract bytes verified; building Go CLI.', flush=True)
            binary = directory / 'db-manager'; run(['go', 'build', '-trimpath', '-o', str(binary), './cmd/db-manager'], cwd=source)
            tls = directory / 'tls'; tls.mkdir()
            run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=DB Manager WP16 Fixture CA', '-keyout', str(tls / 'ca.key'), '-out', str(tls / 'ca.pem')])
            run(['openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', str(tls / 'server.key'), '-out', str(tls / 'server.csr')])
            (tls / 'extensions').write_text('subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n')
            run(['openssl', 'x509', '-req', '-days', '1', '-in', str(tls / 'server.csr'), '-CA', str(tls / 'ca.pem'), '-CAkey', str(tls / 'ca.key'), '-CAcreateserial', '-extfile', str(tls / 'extensions'), '-out', str(tls / 'server.pem')])
            envfile = directory / 'pg.env'; envfile.write_text('POSTGRES_PASSWORD=' + password + '\nPOSTGRES_DB=f3_probe\n'); envfile.chmod(0o600)
            command = 'chown -R postgres /fixture && chmod 600 /fixture/server.key && exec /usr/local/bin/docker-entrypoint.sh "$@"'
            run(['docker', 'create', '--name', prefix, '--label', 'dbmanager.task=W-P16', '-p', '127.0.0.1::5432', '--env-file', str(envfile), '--entrypoint', 'sh', 'postgres:18.6-alpine', '-c', command, 'fixture', 'postgres', '-c', 'ssl=on', '-c', 'ssl_cert_file=/fixture/server.pem', '-c', 'ssl_key_file=/fixture/server.key']); created = True
            run(['docker', 'cp', str(tls), prefix + ':/fixture'])
            barrier = directory / 'barrier.sh'
            barrier.write_text('touch /fixture/bootstrap_waiting\nwhile [ ! -e /fixture/release_bootstrap ]; do sleep 0.1; done\n')
            run(['docker', 'cp', str(barrier), prefix + ':/docker-entrypoint-initdb.d/00_wp16_bootstrap.sh'])
            run(['docker', 'start', prefix])
            wait(lambda: run(['docker', 'exec', prefix, 'test', '-e', '/fixture/bootstrap_waiting']) == '', 'PostgreSQL bootstrap barrier')
            run(['docker', 'exec', prefix, 'touch', '/fixture/release_bootstrap'])
            wait(lambda: 'accepting connections' in run(['docker', 'exec', prefix, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'f3_probe']), 'final PostgreSQL TCP readiness')
            time.sleep(2)
            pgport = int(json.loads(run(['docker', 'inspect', '--format', '{{json .NetworkSettings.Ports}}', prefix]))['5432/tcp'][0]['HostPort'])
            tokenfile = directory / 'token'; tokenfile.write_text(token + '\n'); tokenfile.chmod(0o600)
            backendport = port(); backend = f'http://127.0.0.1:{backendport}'
            environment = dict(os.environ, DBM_TOKEN_FILE=str(tokenfile), DBM_DATA_DIR=str(directory / 'data'), DBM_ADDRESS=f'127.0.0.1:{backendport}', DBM_ALLOWED_HOSTS='localhost,127.0.0.1', DBM_DB_CA_FILE=str(tls / 'ca.pem'))
            log = (directory / 'go.log').open('w'); logs.append(log)
            processes.append(subprocess.Popen([str(binary)], env=environment, stdout=log, stderr=log))
            wait(lambda: api(backend, '/healthz')['status'] == 'ok', 'Go server')
            pg = {'driver': 'postgres', 'host': 'localhost', 'port': pgport, 'username': 'postgres', 'password': password, 'database': 'f3_probe', 'tls_mode': 'verify-full'}
            api(backend, '/api/v1/connections/test', token, {'connection': pg})
            webport = port(); webbase = f'http://127.0.0.1:{webport}'
            log = (directory / 'web.log').open('w'); logs.append(log)
            processes.append(subprocess.Popen((['node', 'scripts/embedded-proxy.mjs', str(webport)] if os.environ.get('DBM_EMBEDDED') == '1' else ['npm', 'run', 'preview', '--', '--port', str(webport), '--strictPort']), cwd=ROOT, env=dict(os.environ, DB_MANAGER_BACKEND_URL=backend), stdout=log, stderr=log, start_new_session=True))
            wait(lambda: urllib.request.urlopen(webbase, timeout=2).status == 200, 'web preview')
            config = directory / 'config.json'
            config.write_text(json.dumps({'baseURL': webbase, 'token': token, 'password': password, 'invalidToken': invalid, 'postgresPort': pgport, 'backendURL': backend, 'outputDir': str(directory / 'results')})); config.chmod(0o600)
            environment = dict(os.environ, DBM_REAL_CONFIG=str(config), CI='1')
            run(['npx', 'playwright', 'install', 'chromium'], cwd=ROOT, env=environment)
            print(redact(run(['npx', 'playwright', 'test', '--config', 'playwright.real.config.ts', '--reporter=line', 'tests/real/sql-editor.spec.ts'], cwd=ROOT, env=environment)), flush=True)
            print('W-P16 real: SQLite and PostgreSQL CodeMirror SQL editor through the UI passed against backend', sha, flush=True)
        finally:
            import signal
            for process in reversed(processes):
                if process.poll() is None:
                    if process.args[0] == 'npm': os.killpg(process.pid, signal.SIGTERM)
                    else: process.terminate()
                    process.wait(timeout=15)
            for log in logs: log.close()
            if created: run(['docker', 'rm', '-fv', prefix])
    print('W-P16 task-owned processes, container/volume and temporary checkout removed.', flush=True)

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(redact(error), file=sys.stderr); sys.exit(1)
