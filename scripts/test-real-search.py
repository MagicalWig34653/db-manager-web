#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""W-P14: run the production web UI (search and replace) against a real Go backend with a throwaway SQLite
database. Backend source: DBM_BACKEND_REPO/DBM_BACKEND_REV (local checkout, default HEAD) or the
public commit pinned in src/lib/contract/v14/provenance.json. PostgreSQL is not covered here."""
import hashlib, importlib.util, json, os, secrets, subprocess, sys, tarfile, tempfile, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('real_tables', ROOT / 'scripts/test-real-tables.py')
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
run, wait, port, api, redact = base.run, base.wait, base.port, base.api, base.redact
PIN = json.loads((ROOT / 'src/lib/contract/v14/provenance.json').read_text())

def fetch_backend(source: Path):
    repo = os.environ.get('DBM_BACKEND_REPO')
    if repo:
        sha = run(['git', '-C', repo, 'rev-parse', os.environ.get('DBM_BACKEND_REV', 'HEAD')])
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
    token = secrets.token_urlsafe(48); base.HIDDEN.append(token)
    parent = ROOT / 'node_modules/.cache'; parent.mkdir(parents=True, exist_ok=True)
    processes = []; logs = []
    if os.environ.get('DBM_EMBEDDED') != '1': run(['npm', 'run', 'build'], cwd=ROOT)
    with tempfile.TemporaryDirectory(prefix='dbmanager-wp14-', dir=parent) as temp:
        directory = Path(temp); source = directory / 'backend'; source.mkdir()
        try:
            sha = fetch_backend(source)
            assert hashlib.sha256((source / PIN['source_path']).read_bytes()).hexdigest() == PIN['sha256']
            print('W-P14 backend revision', sha, '- contract 0.14.0 bytes verified; building Go CLI.', flush=True)
            binary = directory / 'db-manager'; run(['go', 'build', '-trimpath', '-o', str(binary), './cmd/db-manager'], cwd=source)
            tokenfile = directory / 'token'; tokenfile.write_text(token + '\n'); tokenfile.chmod(0o600)
            backendport = port(); backend = f'http://127.0.0.1:{backendport}'
            environment = dict(os.environ, DBM_TOKEN_FILE=str(tokenfile), DBM_DATA_DIR=str(directory / 'data'), DBM_ADDRESS=f'127.0.0.1:{backendport}', DBM_ALLOWED_HOSTS='localhost,127.0.0.1')
            log = (directory / 'go.log').open('w'); logs.append(log)
            processes.append(subprocess.Popen([str(binary)], env=environment, stdout=log, stderr=log))
            wait(lambda: api(backend, '/healthz')['status'] == 'ok', 'Go server')
            connection = {'driver': 'sqlite', 'database': 'wp14_fixture'}
            for sql in ['CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)', "INSERT INTO notes(body) VALUES('alpha foo'),('beta'),('foo foo')"]:
                api(backend, '/api/v1/query', token, {'connection': connection, 'sql': sql})
            caps = api(backend, '/api/v14/capabilities', token)
            assert 'search' in caps['features'], caps
            webport = port(); webbase = f'http://127.0.0.1:{webport}'
            log = (directory / 'web.log').open('w'); logs.append(log)
            processes.append(subprocess.Popen((['node', 'scripts/embedded-proxy.mjs', str(webport)] if os.environ.get('DBM_EMBEDDED') == '1' else ['npm', 'run', 'preview', '--', '--port', str(webport), '--strictPort']), cwd=ROOT, env=dict(os.environ, DB_MANAGER_BACKEND_URL=backend), stdout=log, stderr=log, start_new_session=True))
            wait(lambda: urllib.request.urlopen(webbase, timeout=2).status == 200, 'web preview')
            config = directory / 'config.json'
            config.write_text(json.dumps({'baseURL': webbase, 'outputDir': str(directory / 'results'), 'token': token, 'backendURL': backend, 'connection': connection})); config.chmod(0o600)
            environment = dict(os.environ, DBM_REAL_CONFIG=str(config), DBM_REAL_SEARCH_CONFIG=str(config), CI='1')
            run(['npx', 'playwright', 'install', 'chromium'], cwd=ROOT, env=environment)
            print(redact(run(['npx', 'playwright', 'test', '--config', 'playwright.real.config.ts', '--reporter=line', 'tests/real/search.spec.ts'], cwd=ROOT, env=environment)), flush=True)
            print('W-P14 real: SQLite search and replace through the UI passed against backend', sha, flush=True)
        finally:
            import signal
            for process in reversed(processes):
                if process.poll() is None:
                    if process.args[0] == 'npm': os.killpg(process.pid, signal.SIGTERM)
                    else: process.terminate()
                    process.wait(timeout=15)
            for log in logs: log.close()
    print('W-P14 task-owned processes and temporary checkout removed.', flush=True)

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(redact(error), file=sys.stderr); sys.exit(1)
