#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""W-P17/W-P27: run the production web UI (server administration 0.17, monitor 0.20) against a real Go
backend. SQLite always; MySQL, MariaDB and PostgreSQL (TLS verify-full, disposable containers started
through the backend's scripts/dbfix.py, one after the other) when Docker is available.
Backend source: DBM_BACKEND_REPO / DBM_BACKEND_REV (a local checkout, default HEAD) or the public commit
pinned in src/lib/contract/v17/provenance.json. The preview server uses a free random port (never 4179).
Set DBM_REAL_SYSTEMS=sqlite,mysql,maria,postgres to restrict the run."""
import hashlib, importlib.util, json, os, secrets, signal, subprocess, sys, tarfile, tempfile, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('real_tables', ROOT / 'scripts/test-real-tables.py')
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
run, wait, port, api, redact = base.run, base.wait, base.port, base.api, base.redact
PINS = {name: json.loads((ROOT / f'src/lib/contract/{name}/provenance.json').read_text()) for name in ('v17', 'v20')}
FIXTURE_USER = {'mysql': 'root', 'maria': 'root', 'postgres': 'postgres'}

def fetch_backend(source: Path):
    repo = os.environ.get('DBM_BACKEND_REPO')
    if repo:
        sha = run(['git', '-C', repo, 'rev-parse', os.environ.get('DBM_BACKEND_REV', 'HEAD')])
        archive = source.parent / 'backend.tar'
        run(['git', '-C', repo, 'archive', '--format=tar', '-o', str(archive), sha])
        with tarfile.open(archive) as tar: tar.extractall(source, filter='data')
        return sha
    pin = PINS['v17']
    run(['git', 'init', '--initial-branch=fixture', str(source)])
    run(['git', '-C', str(source), 'remote', 'add', 'origin', pin['source'] + '.git'])
    run(['git', '-C', str(source), 'fetch', '--depth=1', 'origin', pin['source_commit']])
    run(['git', '-C', str(source), 'checkout', '--detach', 'FETCH_HEAD'])
    return run(['git', '-C', str(source), 'rev-parse', 'HEAD'])

def docker_available():
    try: run(['docker', 'info'], timeout=30); return True
    except Exception: return False

def start_backend(directory, binary, token, ca=None):
    tokenfile = directory / 'token'; tokenfile.write_text(token + '\n'); tokenfile.chmod(0o600)
    backendport = port(); backend = f'http://127.0.0.1:{backendport}'
    environment = dict(os.environ, DBM_TOKEN_FILE=str(tokenfile), DBM_DATA_DIR=str(directory / 'data'),
                       DBM_ADDRESS=f'127.0.0.1:{backendport}', DBM_ALLOWED_HOSTS='localhost,127.0.0.1')
    if ca: environment['DBM_DB_CA_FILE'] = str(ca)
    log = (directory / f'go-{backendport}.log').open('w')
    process = subprocess.Popen([str(binary)], env=environment, stdout=log, stderr=log)
    wait(lambda: api(backend, '/healthz')['status'] == 'ok', 'Go server')
    return backend, process, log

def start_web(directory, backend):
    webport = port(); assert webport != 4179
    log = (directory / f'web-{webport}.log').open('w')
    process = subprocess.Popen((['node', 'scripts/embedded-proxy.mjs', str(webport)] if os.environ.get('DBM_EMBEDDED') == '1' else ['npm', 'run', 'preview', '--', '--port', str(webport), '--strictPort']), cwd=ROOT,
                               env=dict(os.environ, DB_MANAGER_BACKEND_URL=backend), stdout=log, stderr=log, start_new_session=True)
    webbase = f'http://127.0.0.1:{webport}'
    wait(lambda: urllib.request.urlopen(webbase, timeout=2).status == 200, 'web preview')
    return webbase, process, log

def stop(process):
    if process.poll() is None:
        if process.args[0] == 'npm': os.killpg(process.pid, signal.SIGTERM)
        else: process.terminate()
        process.wait(timeout=15)

def scenario(system, directory, binary, token, results, connection, ca=None):
    backend, go, golog = start_backend(directory, binary, token, ca)
    web = None
    try:
        # Preconditions through the API itself: the contract versions are offered.
        assert api(backend, '/api/v17/capabilities', token)['contract_version'] == '0.17.0'
        assert api(backend, '/api/v20/capabilities', token)['contract_version'] == '0.20.0'
        webbase, web, weblog = start_web(directory, backend)
        config = directory / f'config-{system}.json'
        config.write_text(json.dumps({'baseURL': webbase, 'outputDir': str(directory / f'results-{system}'), 'token': token,
                                      'backendURL': backend, 'system': system, 'connection': connection}))
        config.chmod(0o600)
        environment = dict(os.environ, DBM_REAL_CONFIG=str(config), CI='1')
        print(redact(run(['npx', 'playwright', 'test', '--config', 'playwright.real.config.ts', '--reporter=line',
                          'tests/real/server-admin.spec.ts'], cwd=ROOT, env=environment)), flush=True)
        results.append(system)
    finally:
        if web: stop(web); weblog.close()
        stop(go); golog.close()

def main():
    token = secrets.token_urlsafe(48); base.HIDDEN.append(token)
    wanted = [s for s in os.environ.get('DBM_REAL_SYSTEMS', 'sqlite,mysql,maria,postgres').split(',') if s]
    parent = ROOT / 'node_modules/.cache'; parent.mkdir(parents=True, exist_ok=True)
    results = []; skipped = []
    if os.environ.get('DBM_EMBEDDED') != '1': run(['npm', 'run', 'build'], cwd=ROOT)
    with tempfile.TemporaryDirectory(prefix='dbmanager-wp17-27-', dir=parent) as temp:
        directory = Path(temp); source = directory / 'backend'; source.mkdir()
        sha = fetch_backend(source)
        for name, pin in PINS.items():
            assert hashlib.sha256((source / pin['source_path']).read_bytes()).hexdigest() == pin['sha256'], name
        print('W-P17/27 backend revision', sha, '- contracts 0.17.0 and 0.20.0 bytes verified; building Go CLI.', flush=True)
        binary = directory / 'db-manager'; run(['go', 'build', '-trimpath', '-o', str(binary), './cmd/db-manager'], cwd=source)
        if 'sqlite' in wanted:
            backend, go, golog = start_backend(directory, binary, token)
            try:
                api(backend, '/api/v1/query', token, {'connection': {'driver': 'sqlite', 'database': 'wp1727_fixture'}, 'sql': 'CREATE TABLE IF NOT EXISTS t(id INTEGER PRIMARY KEY)'})
            finally:
                stop(go); golog.close()
            scenario('sqlite', directory, binary, token, results, {'driver': 'sqlite', 'database': 'wp1727_fixture'})
        network = [s for s in wanted if s in FIXTURE_USER]
        if network and not docker_available():
            skipped += network; network = []
        if network:
            sys.path.insert(0, str(source / 'scripts'))
            from dbfix import Fixtures, PASSWORD
            for system in network:
                with Fixtures('wp1727', systems=(system,)) as fx:
                    ca = fx.fixture_dir / 'ca.pem'
                    connection = {'driver': 'postgres' if system == 'postgres' else 'mysql', 'host': 'localhost',
                                  'port': int(fx.ports[system]), 'username': FIXTURE_USER[system], 'password': PASSWORD,
                                  'database': 'probe', 'tls_mode': 'verify-full'}
                    base.HIDDEN.append(PASSWORD)
                    scenario(system, directory, binary, token, results, connection, ca)
                    fx.cleanup()
                    assert not fx.leftovers(), fx.leftovers()
    print('W-P17/27 real: passed for', ', '.join(results), '- skipped (no Docker):', ', '.join(skipped) or 'none', 'against backend', sha, flush=True)

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(redact(error), file=sys.stderr); sys.exit(1)
