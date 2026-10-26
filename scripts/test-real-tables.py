#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Run the real production web UI against an exact public Go backend and TLS fixtures.

Backend source: the public commit pinned in contract v5 provenance, or a local checkout given by DBM_BACKEND_REPO
(DBM_BACKEND_REV, default HEAD), exported with git archive."""
import hashlib
import json
import os
import re
from pathlib import Path
import secrets
import socket
import subprocess
import tarfile
import sys
import tempfile
import time
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parent.parent
PIN = json.loads((ROOT/'src/lib/contract/v5/provenance.json').read_text())
# Explicit list: feature-specific specs (table-create, overview, ...) bring their own fixtures and runners.
SPECS=['tests/real/table.spec.ts','tests/real/rows.spec.ts','tests/real/structure.spec.ts','tests/real/export.spec.ts']
HIDDEN=[]

def redact(value):
    value=str(value).replace(str(ROOT),'<web-checkout>').replace(str(Path.home()),'<home>')
    for secret in HIDDEN: value=value.replace(secret,'<redacted>')
    return value

def run(args, **kwargs):
    result=subprocess.run(args,text=True,capture_output=True,**kwargs)
    if result.returncode: raise RuntimeError(redact(f'{args[0]} failed ({result.returncode}):\n{result.stdout}\n{result.stderr}'))
    return result.stdout.strip()

def wait(check, label):
    for _ in range(120):
        try:
            if check(): return
        except (OSError, ValueError, RuntimeError, urllib.error.URLError): pass
        time.sleep(.5)
    raise RuntimeError('Timed out: '+label)

def port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1',0)); return listener.getsockname()[1]

def api(base, path, token=None, body=None, expected=200):
    headers={'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    request=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers=headers)
    try: response=urllib.request.urlopen(request,timeout=20)
    except urllib.error.HTTPError as error: response=error
    with response:
        if response.status!=expected:
            try: code=json.load(response).get('error',{}).get('code','unknown')
            except (ValueError,AttributeError): code='unknown'
            if not isinstance(code,str) or not re.fullmatch('[a-z_]{1,64}',code): code='unknown'
            raise RuntimeError(f'{path}: HTTP {response.status}, expected {expected}; public code={code}')
        return json.load(response)

def main():
    prefix='dbmanager-f5-'+secrets.token_hex(6)
    token=secrets.token_urlsafe(48); password=secrets.token_urlsafe(32); invalid=secrets.token_urlsafe(48)
    HIDDEN.extend([token,password,invalid])
    parent=ROOT/'node_modules/.cache';parent.mkdir(parents=True,exist_ok=True)
    created=False;processes=[];logs=[]
    run(['npm','run','build'],cwd=ROOT)
    with tempfile.TemporaryDirectory(prefix=prefix+'-',dir=parent) as temp:
        directory=Path(temp)
        source=directory/'backend';source.mkdir()
        try:
            repo=os.environ.get('DBM_BACKEND_REPO')
            if repo:
                # Pin check of an embedded build: use the given checkout (e.g. the release branch with embedded assets)
                # instead of the old backend commit from provenance, so the served UI is the one under test.
                sha=run(['git','-C',repo,'rev-parse',os.environ.get('DBM_BACKEND_REV','HEAD')])
                archive=directory/'backend.tar'
                run(['git','-C',repo,'archive','--format=tar','-o',str(archive),sha])
                with tarfile.open(archive) as tar: tar.extractall(source,filter='data')
                print('F5 fixture: backend from DBM_BACKEND_REPO '+sha[:12],flush=True)
            else:
                run(['git','init','--initial-branch=fixture',str(source)])
                run(['git','-C',str(source),'remote','add','origin',PIN['source']+'.git'])
                run(['git','-C',str(source),'fetch','--depth=1','origin',PIN['source_commit']])
                run(['git','-C',str(source),'checkout','--detach','FETCH_HEAD'])
                assert run(['git','-C',str(source),'rev-parse','HEAD'])==PIN['source_commit']
            assert hashlib.sha256((source/PIN['source_path']).read_bytes()).hexdigest()==PIN['sha256']
            for version in [1,2,3,4,5]:
                folder=ROOT/'src/lib/contract' if version==1 else ROOT/f'src/lib/contract/v{version}'
                provenance=json.loads((folder/'provenance.json').read_text())
                assert hashlib.sha256((source/f'contracts/api-v0.{version}.0.json').read_bytes()).hexdigest()==provenance['sha256']
            print('F5 fixture: exact public backend/schema verified; building native Go CLI.',flush=True)
            binary=directory/'db-manager';run(['go','build','-trimpath','-o',str(binary),'./cmd/db-manager'],cwd=source)
            tls=directory/'tls';tls.mkdir()
            run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=DB Manager F3 Fixture CA','-keyout',str(tls/'ca.key'),'-out',str(tls/'ca.pem')])
            run(['openssl','req','-newkey','rsa:2048','-nodes','-subj','/CN=localhost','-keyout',str(tls/'server.key'),'-out',str(tls/'server.csr')])
            (tls/'extensions').write_text('subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n')
            run(['openssl','x509','-req','-days','1','-in',str(tls/'server.csr'),'-CA',str(tls/'ca.pem'),'-CAkey',str(tls/'ca.key'),'-CAcreateserial','-extfile',str(tls/'extensions'),'-out',str(tls/'server.pem')])
            envfile=directory/'pg.env';envfile.write_text('POSTGRES_PASSWORD='+password+'\nPOSTGRES_DB=f3_probe\n');envfile.chmod(0o600)
            command='chown -R postgres /fixture && chmod 600 /fixture/server.key && exec /usr/local/bin/docker-entrypoint.sh "$@"'
            run(['docker','create','--name',prefix,'--label','dbmanager.task=F5','-p','127.0.0.1::5432','--env-file',str(envfile),'--entrypoint','sh','postgres:18.6-alpine','-c',command,'fixture','postgres','-c','ssl=on','-c','ssl_cert_file=/fixture/server.pem','-c','ssl_key_file=/fixture/server.key']);created=True
            run(['docker','cp',str(tls),prefix+':/fixture'])
            # Reproduce the official image's socket-only bootstrap phase deterministically.
            barrier=directory/'bootstrap-barrier.sh'
            barrier.write_text('touch /fixture/bootstrap_waiting\nwhile [ ! -e /fixture/release_bootstrap ]; do sleep 0.1; done\n')
            run(['docker','cp',str(barrier),prefix+':/docker-entrypoint-initdb.d/00_f3_bootstrap.sh'])
            run(['docker','start',prefix])
            wait(lambda:run(['docker','exec',prefix,'test','-e','/fixture/bootstrap_waiting'])=='','PostgreSQL bootstrap barrier')
            assert 'accepting connections' in run(['docker','exec',prefix,'pg_isready','-U','postgres','-d','f3_probe'])
            tcp=subprocess.run(['docker','exec',prefix,'pg_isready','-h','127.0.0.1','-U','postgres','-d','f3_probe'],capture_output=True)
            assert tcp.returncode != 0, 'Bootstrap must not be mistaken for final TCP readiness'
            run(['docker','exec',prefix,'touch','/fixture/release_bootstrap'])
            wait(lambda:'accepting connections' in run(['docker','exec',prefix,'pg_isready','-h','127.0.0.1','-U','postgres','-d','f3_probe']),'final PostgreSQL TCP readiness')
            print('F5 fixture: socket-only bootstrap reproduced; final TCP readiness required.',flush=True)
            pgport=int(json.loads(run(['docker','inspect','--format','{{json .NetworkSettings.Ports}}',prefix]))['5432/tcp'][0]['HostPort'])
            tokenfile=directory/'token';tokenfile.write_text(token+'\n');tokenfile.chmod(0o600)
            backendport=port();base=f'http://127.0.0.1:{backendport}'
            environment=dict(os.environ,DBM_TOKEN_FILE=str(tokenfile),DBM_DATA_DIR=str(directory/'data'),DBM_ADDRESS=f'127.0.0.1:{backendport}',DBM_ALLOWED_HOSTS='localhost,127.0.0.1',DBM_DB_CA_FILE=str(tls/'ca.pem'))
            log=(directory/'go.log').open('w');logs.append(log)
            processes.append(subprocess.Popen([str(binary)],env=environment,stdout=log,stderr=log))
            wait(lambda:api(base,'/healthz')['status']=='ok','real pinned Go server')
            pg={'driver':'postgres','host':'localhost','port':pgport,'username':'postgres','password':password,'database':'f3_probe','tls_mode':'verify-full'}
            api(base,'/api/v1/connections/test',token,{'connection':pg})
            api(base,'/api/v1/connections/test',token,{'connection':{**pg,'host':'127.0.0.1'}},422)
            print('F5 fixture: positive verify-full connection followed by wrong-host refusal passed.',flush=True)
            for driver,connection in [('sqlite',{'driver':'sqlite','database':'f3_fixture'}),('postgres',pg)]:
                statement=0
                def query(sql):
                    nonlocal statement
                    statement+=1
                    try: return api(base,'/api/v1/query',token,{'connection':connection,'sql':sql})
                    except RuntimeError as error: raise RuntimeError(f'F5 synthetic {driver} fixture statement {statement}: {error}') from None
                print(f'F5 fixture: setting up synthetic {driver} values, metadata and view.',flush=True)
                table='"odd""name"'
                types='id INTEGER PRIMARY KEY, huge TEXT' if driver=='sqlite' else 'id BIGINT PRIMARY KEY, huge NUMERIC(40,20)'
                payload='BLOB' if driver=='sqlite' else 'BYTEA'
                generation='VIRTUAL' if driver=='sqlite' else 'STORED'
                query(f"CREATE TABLE {table} ({types}, nullable TEXT DEFAULT 'fallback', empty_text TEXT, payload {payload}, generated_text TEXT GENERATED ALWAYS AS (empty_text || 'x') {generation})")
                values=[]
                for i in [*range(1,131),9223372036854775807]:
                    binary_sql="X'00FF'" if driver=='sqlite' else "decode('00ff','hex')"
                    nullable='NULL' if i%2 else "'present'"
                    values.append(f"({i},'12345678901234567890.12345678901234567890',{nullable},'',{binary_sql})")
                query(f'INSERT INTO {table}(id,huge,nullable,empty_text,payload) VALUES '+','.join(values))
                query(f'CREATE VIEW f3_view AS SELECT huge,nullable FROM {table}')
                key='id INTEGER PRIMARY KEY AUTOINCREMENT' if driver=='sqlite' else 'id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY'
                numeric='TEXT' if driver=='sqlite' else 'NUMERIC(40,20)'
                query(f"CREATE TABLE f4_rows ({key}, label TEXT NOT NULL DEFAULT 'default-label', optional TEXT, empty_text TEXT, precise {numeric}, payload {payload}, generated_text TEXT GENERATED ALWAYS AS (label || '-generated') {generation})")
                query("INSERT INTO f4_rows(label,optional,empty_text,precise,payload) VALUES('original',NULL,'','12345678901234567890.12345678901234567890',"+("X'00FF'" if driver=='sqlite' else "decode('00ff','hex')")+")")
                query('CREATE VIEW f4_view AS SELECT * FROM f4_rows')
                query('CREATE TABLE f4_no_pk(value TEXT)')
                query("INSERT INTO f4_no_pk VALUES('read-only')")
                if driver == 'sqlite':
                    query('CREATE TABLE f5_empty_identifier("" TEXT PRIMARY KEY NOT NULL)')
                query('CREATE TABLE f5_parent(id INTEGER PRIMARY KEY)')
                query("CREATE TABLE f5_child(id INTEGER PRIMARY KEY, parent_id INTEGER, label TEXT NOT NULL, extra TEXT, CONSTRAINT child_unique UNIQUE(label), CONSTRAINT child_fk FOREIGN KEY(parent_id) REFERENCES f5_parent(id) ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED, CONSTRAINT child_check CHECK(length(label)>0))")
                query('CREATE INDEX f5_expression_partial ON f5_child(lower(label) DESC) WHERE parent_id IS NOT NULL')
                query('CREATE INDEX f5_column_desc ON f5_child(label DESC)')
                if driver=='postgres':
                    query('CREATE INDEX f5_include ON f5_child(parent_id) INCLUDE(extra)')
                query('CREATE VIEW f5_view AS SELECT id,label FROM f5_child')
                if driver=='postgres':
                    assert query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')['results'][0]['rows'][0][0]['value']=='true'
            webport=port();webbase=f'http://127.0.0.1:{webport}'
            environment=dict(os.environ,DB_MANAGER_BACKEND_URL=base)
            log=(directory/'web.log').open('w');logs.append(log)
            processes.append(subprocess.Popen(['npm','run','preview','--','--port',str(webport),'--strictPort'],cwd=ROOT,env=environment,stdout=log,stderr=log,start_new_session=True))
            wait(lambda:urllib.request.urlopen(webbase,timeout=2).status==200,'production web preview with real same-origin API proxy')
            config=directory/'config.json';config.write_text(json.dumps({'baseURL':webbase,'token':token,'password':password,'invalidToken':invalid,'postgresPort':pgport,'backendURL':base,'outputDir':str(directory/'results')}));config.chmod(0o600)
            environment=dict(os.environ,DBM_REAL_CONFIG=str(config),CI='1')
            run(['npx','playwright','install','chromium'],cwd=ROOT,env=environment)
            print(redact(run(['npx','playwright','test','--config','playwright.real.config.ts','--reporter=line',*SPECS],cwd=ROOT,env=environment)),flush=True)
            print('F5 real: exact public backend/schema, SQLite/PostgreSQL verify-full, structured browse and row insert/update/delete/conflict/lost-commit-response/session checks passed.',flush=True)
        finally:
            import signal
            for process in reversed(processes):
                if process.poll() is None:
                    if process.args[0]=='npm': os.killpg(process.pid,signal.SIGTERM)
                    else: process.terminate()
                    process.wait(timeout=15)
            for log in logs: log.close()
            if created: run(['docker','rm','-fv',prefix])
    print('F5 task-owned processes, database container/volume, private credentials and pinned temporary checkout removed.',flush=True)

if __name__=='__main__':
    try: main()
    except Exception as error:
        print(redact(error),file=sys.stderr);sys.exit(1)
