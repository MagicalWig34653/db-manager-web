#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""W-P20: run the production web UI against the real Go backend (main with API 0.24) using a disposable MariaDB 12.3
(TLS) as server state. Task-owned only: the database container comes from the backend's scripts/dbfix.py (unique
prefix dbmanager-w-p20-web-*, removed afterwards), web and backend run on free ports, nothing foreign is touched.

Backend source: DBM_BACKEND_REPO (default: the local backend checkout next to this repository), revision
DBM_BACKEND_REV (default: the commit pinned in src/lib/contract/v24/provenance.json), exported with git archive.
Needs Docker, Go, Node, openssl."""
import hashlib, importlib.util, json, os, secrets, signal, subprocess, sys, tarfile, tempfile, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('real_tables', ROOT / 'scripts/test-real-tables.py')
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
run, wait, port, api, redact = base.run, base.wait, base.port, base.api, base.redact
PIN = json.loads((ROOT / 'src/lib/contract/v24/provenance.json').read_text())
DEFAULT_REPO = next((p / 'GoLand/db-manager' for p in ROOT.parents if (p / 'GoLand/db-manager').is_dir()), ROOT)


def load_dbfix(repo: Path):
    module_spec = importlib.util.spec_from_file_location('dbfix', repo / 'scripts/dbfix.py')
    module = importlib.util.module_from_spec(module_spec); module_spec.loader.exec_module(module)
    return module


def sql(container, password, statement):
    run(['docker', 'exec', container, 'mariadb', '--skip-ssl', '--protocol=tcp', '--host=127.0.0.1', '--user=root',
         '--password=' + password, '-e', statement])


def main():
    token = secrets.token_urlsafe(48); base.HIDDEN.append(token)
    repo = Path(os.environ.get('DBM_BACKEND_REPO', DEFAULT_REPO))
    dbfix = load_dbfix(repo)
    parent = ROOT / 'node_modules/.cache'; parent.mkdir(parents=True, exist_ok=True)
    processes = []; logs = []
    if os.environ.get('DBM_EMBEDDED') != '1': run(['npm', 'run', 'build'], cwd=ROOT)
    with tempfile.TemporaryDirectory(prefix='dbmanager-wp20web-', dir=parent) as temp, dbfix.Fixtures('w-p20-web', systems=('maria',)) as fx:
        directory = Path(temp); source = directory / 'backend'; source.mkdir()
        container = fx.containers[0]
        try:
            sha = run(['git', '-C', str(repo), 'rev-parse', os.environ.get('DBM_BACKEND_REV', PIN['source_commit'])])
            archive = directory / 'backend.tar'
            run(['git', '-C', str(repo), 'archive', '--format=tar', '-o', str(archive), sha])
            with tarfile.open(archive) as tar: tar.extractall(source, filter='data')
            assert hashlib.sha256((source / PIN['source_path']).read_bytes()).hexdigest() == PIN['sha256']
            print('W-P20 web: backend revision', sha[:12], '- contract 0.24.0 bytes verified; building Go CLI.', flush=True)
            binary = directory / 'db-manager'; run(['go', 'build', '-trimpath', '-o', str(binary), './cmd/db-manager'], cwd=source)
            # Server state: database, runtime user (no DDL) and migration user on the disposable MariaDB.
            suffix = secrets.token_hex(4)
            name, runtime, migrate = 'wp20_' + suffix, 'rt_' + suffix, 'mg_' + suffix
            runtime_pw, migrate_pw = secrets.token_hex(16), secrets.token_hex(16)
            base.HIDDEN.extend([runtime_pw, migrate_pw])
            for statement in [
                f'CREATE DATABASE {name} CHARACTER SET utf8mb4',
                f"CREATE USER '{runtime}'@'%' IDENTIFIED BY '{runtime_pw}' REQUIRE SSL",
                f"CREATE USER '{migrate}'@'%' IDENTIFIED BY '{migrate_pw}' REQUIRE SSL",
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON {name}.* TO '{runtime}'@'%'",
                f"GRANT ALL PRIVILEGES ON {name}.* TO '{migrate}'@'%'",
            ]: sql(container, dbfix.PASSWORD, statement)
            secrets_dir = directory / 'secrets'; secrets_dir.mkdir(); secrets_dir.chmod(0o700)
            files = {}
            for label, value in [('runtime', runtime_pw), ('migrate', migrate_pw), ('key', secrets.token_hex(32)), ('token', token)]:
                path = secrets_dir / label; path.write_text(value + '\n'); path.chmod(0o600); files[label] = str(path)
            state = dict(DBM_STATE_DB_HOST='localhost', DBM_STATE_DB_PORT=fx.ports['maria'], DBM_STATE_DB_NAME=name,
                         DBM_STATE_DB_USER=runtime, DBM_STATE_DB_PASSWORD_FILE=files['runtime'],
                         DBM_STATE_DB_CA_FILE=str(fx.fixture_dir / 'ca.pem'), DBM_STATE_SERVER_KEY_FILE=files['key'])
            common = dict(os.environ, DBM_TOKEN_FILE=files['token'], DBM_ALLOWED_HOSTS='localhost,127.0.0.1')
            # Migration with the DDL user as an explicit one-shot step; the running service gets no DDL rights.
            migration_env = dict(common, **state, DBM_STATE_DB_MIGRATE_USER=migrate, DBM_STATE_DB_MIGRATE_PASSWORD_FILE=files['migrate'], DBM_DATA_DIR=str(directory / 'data-m'))
            print(redact(run([str(binary), 'state-migrate'], env=migration_env)) or 'W-P20 web: state-migrate done.', flush=True)

            def start_backend(label, extra):
                p = port(); url = f'http://127.0.0.1:{p}'
                env = dict(common, DBM_DATA_DIR=str(directory / ('data-' + label)), DBM_ADDRESS=f'127.0.0.1:{p}', **extra)
                log = (directory / (label + '.log')).open('w'); logs.append(log)
                processes.append(subprocess.Popen([str(binary)], env=env, stdout=log, stderr=log))
                wait(lambda: api(url, '/healthz')['status'] == 'ok', label + ' backend')
                return url

            def start_web(label, backend):
                p = port(); url = f'http://127.0.0.1:{p}'
                log = (directory / (label + '-web.log')).open('w'); logs.append(log)
                command = ['node', 'scripts/embedded-proxy.mjs', str(p)] if os.environ.get('DBM_EMBEDDED') == '1' else ['npm', 'run', 'preview', '--', '--port', str(p), '--strictPort']
                processes.append(subprocess.Popen(command, cwd=ROOT, env=dict(os.environ, DB_MANAGER_BACKEND_URL=backend), stdout=log, stderr=log, start_new_session=True))
                wait(lambda: urllib.request.urlopen(url, timeout=2).status == 200, label + ' web')
                return url

            backend = start_backend('state', state)
            caps = api(backend, '/api/v24/capabilities', token)
            assert caps['available'] and caps['mode'] == 'server' and caps['reason'] == 'ok', caps
            local_backend = start_backend('local', {})
            caps = api(local_backend, '/api/v24/capabilities', token)
            assert caps['mode'] == 'local_only' and caps['reason'] == 'not_configured', caps
            web = start_web('state', backend); local_web = start_web('local', local_backend)
            connection = {'driver': 'sqlite', 'database': 'wp20_fixture'}
            config = directory / 'config.json'
            config.write_text(json.dumps({'baseURL': web, 'outputDir': str(directory / 'results'), 'token': token, 'backendURL': backend,
                                          'localOnlyURL': local_web, 'connection': connection, 'container': container})); config.chmod(0o600)
            environment = dict(os.environ, DBM_REAL_CONFIG=str(config), CI='1')
            run(['npx', 'playwright', 'install', 'chromium'], cwd=ROOT, env=environment)
            print(redact(run(['npx', 'playwright', 'test', '--config', 'playwright.real.config.ts', '--reporter=line', 'tests/real/config-store.spec.ts'], cwd=ROOT, env=environment)), flush=True)
            print('W-P20 web real: config store (server mode, migration, opt-in, 412 merge, export, clear, outage, local mode) passed against backend', sha[:12], flush=True)
        finally:
            for process in reversed(processes):
                if process.poll() is None:
                    if process.args[0] == 'npm': os.killpg(process.pid, signal.SIGTERM)
                    else: process.terminate()
                    try: process.wait(timeout=15)
                    except subprocess.TimeoutExpired: process.kill()
            for log in logs: log.close()
    print('W-P20 web: task-owned containers, processes and temporary checkout removed.', flush=True)


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(redact(error), file=sys.stderr); sys.exit(1)
