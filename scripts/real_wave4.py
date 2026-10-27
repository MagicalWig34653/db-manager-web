# SPDX-License-Identifier: AGPL-3.0-only
"""Shared harness for the real runs of the wave 4 web packages (W-P28 export formats, W-P29 partitions).

Builds the Go backend from a local checkout (DBM_BACKEND_REPO, revision DBM_BACKEND_REV, default HEAD; exported
with git archive so uncommitted changes are never built), starts a throwaway PostgreSQL 18.6 container (TLS
verify-full) and the backend on random loopback ports, serves the production web build with a same-origin API
proxy and runs one Playwright spec against it. Never uses a fixed port. Everything task-owned is removed."""
import hashlib, json, os, secrets, signal, subprocess, sys, tarfile, tempfile, time, urllib.request
from pathlib import Path
import importlib.util

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location('real_tables', ROOT / 'scripts/test-real-tables.py')
_base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_base)
run, wait, port, api, redact, HIDDEN = _base.run, _base.wait, _base.port, _base.api, _base.redact, _base.HIDDEN


def fetch_backend(source: Path):
    repo = os.environ.get('DBM_BACKEND_REPO')
    if not repo:
        raise RuntimeError('Set DBM_BACKEND_REPO to a checkout of the Go backend (and DBM_BACKEND_REV, e.g. d9463ba).')
    rev = os.environ.get('DBM_BACKEND_REV', 'HEAD')
    sha = run(['git', '-C', repo, 'rev-parse', rev])
    archive = source.parent / 'backend.tar'
    run(['git', '-C', repo, 'archive', '--format=tar', '-o', str(archive), sha])
    with tarfile.open(archive) as tar:
        tar.extractall(source, filter='data')
    return sha


def verify_contracts(source: Path, majors):
    for major in majors:
        folder = ROOT / f'src/lib/contract/v{major}'
        pin = json.loads((folder / 'provenance.json').read_text())
        backend = (source / pin['source_path']).read_bytes()
        assert hashlib.sha256(backend).hexdigest() == pin['sha256'], f'v{major}: backend contract differs from the pin'
        assert backend == (folder / f'api-v0.{major}.0.json').read_bytes(), f'v{major}: vendored copy differs'


def harness(label, spec, majors, sha_hook, after=None):
    """label: short tag; spec: playwright spec path; sha_hook(api_base, token, pg, ctx): prepares fixtures;
    after(ctx): independent checks once Playwright passed. ctx is a dict shared with the spec config file."""
    prefix = f'dbmanager-{label}-web-' + secrets.token_hex(6)
    token = secrets.token_urlsafe(48)
    password = secrets.token_urlsafe(32)
    HIDDEN.extend([token, password])
    parent = ROOT / 'node_modules/.cache'
    parent.mkdir(parents=True, exist_ok=True)
    created = False
    processes, logs = [], []
    run(['npm', 'run', 'build'], cwd=ROOT)
    with tempfile.TemporaryDirectory(prefix=prefix + '-', dir=parent) as temp:
        directory = Path(temp)
        source = directory / 'backend'
        source.mkdir()
        try:
            sha = fetch_backend(source)
            verify_contracts(source, majors)
            print(f'{label} real: backend {sha}; vendored contracts {majors} are byte-identical; building Go CLI.', flush=True)
            binary = directory / 'db-manager'
            run(['go', 'build', '-trimpath', '-o', str(binary), './cmd/db-manager'], cwd=source)
            tls = directory / 'tls'
            tls.mkdir()
            run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=DB Manager Web Fixture CA', '-keyout', str(tls / 'ca.key'), '-out', str(tls / 'ca.pem')])
            run(['openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', str(tls / 'server.key'), '-out', str(tls / 'server.csr')])
            (tls / 'extensions').write_text('subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n')
            run(['openssl', 'x509', '-req', '-days', '1', '-in', str(tls / 'server.csr'), '-CA', str(tls / 'ca.pem'), '-CAkey', str(tls / 'ca.key'), '-CAcreateserial', '-extfile', str(tls / 'extensions'), '-out', str(tls / 'server.pem')])
            envfile = directory / 'pg.env'
            envfile.write_text('POSTGRES_PASSWORD=' + password + '\nPOSTGRES_DB=w4_probe\n')
            envfile.chmod(0o600)
            command = 'chown -R postgres /fixture && chmod 600 /fixture/server.key && exec /usr/local/bin/docker-entrypoint.sh "$@"'
            run(['docker', 'create', '--name', prefix, '--label', f'dbmanager.task={label}-web', '-p', '127.0.0.1::5432', '--env-file', str(envfile), '--entrypoint', 'sh', 'postgres:18.6-alpine', '-c', command, 'fixture', 'postgres', '-c', 'ssl=on', '-c', 'ssl_cert_file=/fixture/server.pem', '-c', 'ssl_key_file=/fixture/server.key'])
            created = True
            run(['docker', 'cp', str(tls), prefix + ':/fixture'])
            barrier = directory / 'barrier.sh'
            barrier.write_text('touch /fixture/bootstrap_waiting\nwhile [ ! -e /fixture/release_bootstrap ]; do sleep 0.1; done\n')
            run(['docker', 'cp', str(barrier), prefix + ':/docker-entrypoint-initdb.d/00_bootstrap.sh'])
            run(['docker', 'start', prefix])
            wait(lambda: run(['docker', 'exec', prefix, 'test', '-e', '/fixture/bootstrap_waiting']) == '', 'PostgreSQL bootstrap barrier')
            run(['docker', 'exec', prefix, 'touch', '/fixture/release_bootstrap'])
            wait(lambda: 'accepting connections' in run(['docker', 'exec', prefix, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'w4_probe']), 'final PostgreSQL TCP readiness')
            time.sleep(2)
            pgport = int(json.loads(run(['docker', 'inspect', '--format', '{{json .NetworkSettings.Ports}}', prefix]))['5432/tcp'][0]['HostPort'])
            tokenfile = directory / 'token'
            tokenfile.write_text(token + '\n')
            tokenfile.chmod(0o600)
            backendport = port()
            backend = f'http://127.0.0.1:{backendport}'
            environment = dict(os.environ, DBM_TOKEN_FILE=str(tokenfile), DBM_DATA_DIR=str(directory / 'data'), DBM_ADDRESS=f'127.0.0.1:{backendport}', DBM_ALLOWED_HOSTS='localhost,127.0.0.1', DBM_DB_CA_FILE=str(tls / 'ca.pem'))
            log = (directory / 'go.log').open('w')
            logs.append(log)
            processes.append(subprocess.Popen([str(binary)], env=environment, stdout=log, stderr=log))
            wait(lambda: api(backend, '/healthz')['status'] == 'ok', 'Go server')
            pg = {'driver': 'postgres', 'host': 'localhost', 'port': pgport, 'username': 'postgres', 'password': password, 'database': 'w4_probe', 'tls_mode': 'verify-full'}
            stable = {'count': 0}

            def ready():
                try:
                    api(backend, '/api/v1/connections/test', token, {'connection': pg})
                    stable['count'] += 1
                except Exception:
                    stable['count'] = 0
                    return False
                return stable['count'] >= 4
            wait(ready, 'stable PostgreSQL verify-full connection')
            ctx = {'token': token, 'password': password, 'postgresPort': pgport, 'backendURL': backend, 'outputDir': str(directory / 'results'), 'dumpDir': str(directory / 'dumps'), 'sha': sha, 'container': prefix}
            sha_hook(backend, token, pg, ctx)
            webport = port()
            webbase = f'http://127.0.0.1:{webport}'
            ctx['baseURL'] = webbase
            log = (directory / 'web.log').open('w')
            logs.append(log)
            processes.append(subprocess.Popen(['npm', 'run', 'preview', '--', '--port', str(webport), '--strictPort'], cwd=ROOT, env=dict(os.environ, DB_MANAGER_BACKEND_URL=backend), stdout=log, stderr=log, start_new_session=True))
            wait(lambda: urllib.request.urlopen(webbase, timeout=2).status == 200, 'production web preview with same-origin API proxy')
            config = directory / 'config.json'
            config.write_text(json.dumps(ctx))
            config.chmod(0o600)
            environment = dict(os.environ, DBM_REAL_CONFIG=str(config), CI='1')
            run(['npx', 'playwright', 'install', 'chromium'], cwd=ROOT, env=environment)
            print(redact(run(['npx', 'playwright', 'test', '--config', 'playwright.real.config.ts', '--reporter=line', spec], cwd=ROOT, env=environment)), flush=True)
            if after:
                after(ctx, pg)
            print(f'{label} real: passed against backend {sha}.', flush=True)
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
    print(f'{label} task-owned processes, container/volume and temporary files removed.', flush=True)


def guarded(main):
    try:
        main()
    except Exception as error:
        print(redact(f'{type(error).__name__}: {error}'), file=sys.stderr)
        sys.exit(1)
