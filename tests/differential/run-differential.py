#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Reviewer differential: run unformatted vs formatted statements on real PostgreSQL / MySQL / MariaDB.

Input: JSON files written by src/lib/features/sql-editor/rereview-differential.test.ts (DBM_CORPUS_OUT).
Needs psycopg and pymysql (pip, not a project dependency) and the backend repo's scripts/dbfix.py (own throw-away
containers only). Statements are read-only SELECTs; PostgreSQL runs with default_transaction_read_only.
Usage: run-differential.py <backend-repo> <corpus-dir> <out-json>
"""
import json, sys, time
from pathlib import Path

backend, corpus, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
sys.path.insert(0, str(backend / 'scripts'))
from dbfix import Fixtures, PASSWORD  # noqa: E402
import psycopg, pymysql  # noqa: E402


def norm(v):
    if isinstance(v, (bytes, bytearray, memoryview)):
        return '0x' + bytes(v).hex()
    if isinstance(v, (list, tuple)):
        return [norm(x) for x in v]
    if isinstance(v, dict):
        return {k: norm(x) for k, x in v.items()}
    return repr(v)


def retry(fn):
    # The image entrypoint restarts the server once after its initialisation phase; wait for the final one.
    for _ in range(120):
        try:
            return fn()
        except Exception:  # noqa
            time.sleep(1)
    return fn()


def pg_runner(port):
    conn = retry(lambda: psycopg.connect(host='127.0.0.1', port=port, user='postgres', password=PASSWORD, dbname='probe',
                                         sslmode='require', autocommit=True))
    conn.execute('SET default_transaction_read_only = on')
    conn.execute("SET statement_timeout = '5s'")

    def run(sql):
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
                rows = cur.fetchall() if cur.description else []
            return 'ok:' + json.dumps([norm(r) for r in rows], sort_keys=True)
        except psycopg.Error as e:
            return 'err:' + str(e.sqlstate)
        except Exception as e:  # noqa
            return 'exc:' + type(e).__name__
    return run


def my_runner(port, maria):
    def connect():
        c = pymysql.connect(host='127.0.0.1', port=port, user='root', password=PASSWORD, database='probe', autocommit=True,
                            charset='utf8mb4', read_timeout=10)
        cur = c.cursor()
        cur.execute('SET SESSION TRANSACTION READ ONLY')
        cur.execute('SET SESSION ' + ('max_statement_time=5' if maria else 'max_execution_time=5000'))
        return c
    state = {'c': retry(connect)}

    def run(sql):
        for attempt in (0, 1):
            try:
                with state['c'].cursor() as cur:
                    cur.execute(sql)
                    rows = cur.fetchall() if cur.description else []
                    while cur.nextset():
                        pass
                return 'ok:' + json.dumps([norm(r) for r in rows], sort_keys=True)
            except pymysql.err.MySQLError as e:
                return 'err:' + str(e.args[0])
            except Exception as e:  # noqa
                try:
                    state['c'] = connect()
                except Exception:
                    pass
                if attempt == 1:
                    return 'exc:' + type(e).__name__
    return run


def klass(a, b):
    ka = a.split(':')[0]
    kb = b.split(':')[0]
    return ka + '->' + kb + ('' if ka != kb else ('-same-class' if a.split(':')[1][:0] == '' and ka == 'err' and a == b else '-differ'))


def compare(name, run, pairs, report):
    bad, ok, errs = {}, 0, 0
    differ = 0
    for p in pairs:
        a, b = run(p['o']), run(p['f'])
        if a.startswith('ok'):
            ok += 1
        elif a.startswith('err'):
            errs += 1
        if a != b:
            differ += 1
            k = klass(a, b)
            bucket = bad.setdefault(k, [])
            if len(bucket) < 400:
                bucket.append({'o': p['o'], 'f': p['f'], 'orig': a[:300], 'fmt': b[:300]})
    report[name] = {'pairs': len(pairs), 'ok': ok, 'errors': errs, 'differ': differ,
                    'classes': {k: len(v) for k, v in bad.items()}, 'examples': bad}
    print(name, report[name]['pairs'], 'pairs', ok, 'ok', errs, 'err', differ, 'DIFFER', report[name]['classes'], flush=True)


report = {}
with Fixtures('w-p16-rr', systems=('mysql', 'maria', 'postgres')) as fx:
    print('fixtures up', fx.prefix, flush=True)
    for d, runner in (('postgresql', lambda: ('postgres', pg_runner(int(fx.ports['postgres'])))),
                      ('mysql', lambda: ('mysql84', my_runner(int(fx.ports['mysql']), False))),
                      ('mysql', lambda: ('mariadb123', my_runner(int(fx.ports['maria']), True)))):
        name, run = runner()
        pairs = json.loads((corpus / (d + '.json')).read_text())
        compare(name, run, pairs, report)
out.write_text(json.dumps(report, indent=1, ensure_ascii=False))
