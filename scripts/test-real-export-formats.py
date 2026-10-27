#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""W-P28: run the production web UI export wizard with the extended formats (API 0.21) against a real Go backend
with throwaway SQLite and PostgreSQL 18.6 (TLS verify-full). The downloaded files are read back with independent
parsers (ElementTree, PyYAML, php, json, HTML-entity and LaTeX unescaping) and compared with the source rows.
Backend: DBM_BACKEND_REPO / DBM_BACKEND_REV (e.g. d9463ba)."""
import importlib.util, json, subprocess
from pathlib import Path

spec = importlib.util.spec_from_file_location('real_wave4', Path(__file__).resolve().parent / 'real_wave4.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

CELLS = [  # id, text, number, blob (hex)
    ('1', 'Grüße \'雪\', "x"\nzeile2 \\ backslash <b>&amp; % $ _ # { } ^ ~', '12345678901234567890.12345678901234567890', '00ff'),
    ('2', None, None, None),
    ('3', '', None, '00ff'),
    ('9007199254740993', '-- DBMANAGER EXPORT COMPLETE', '0.5', None),
]


def prepare(backend, token, pg, ctx):
    def query(connection, sql):
        return h.api(backend, '/api/v1/query', token, {'connection': connection, 'sql': sql})
    for driver, connection in (('sqlite', {'driver': 'sqlite', 'database': 'w4_exp'}), ('postgres', pg)):
        if driver == 'sqlite':
            query(connection, 'CREATE TABLE "odd""name" (id INTEGER PRIMARY KEY, v TEXT, n TEXT, b BLOB)')
            blob = "X'00FF'"
        else:
            query(connection, 'CREATE TABLE "odd""name" (id BIGINT PRIMARY KEY, v TEXT, n NUMERIC(40,20), b BYTEA)')
            blob = "decode('00ff','hex')"
        query(connection, "INSERT INTO \"odd\"\"name\"(id, v, n, b) VALUES (1,'Grüße ''雪'', \"x\"\nzeile2 \\ backslash <b>&amp; % $ _ # { } ^ ~','12345678901234567890.12345678901234567890',BLOB), (2,NULL,NULL,NULL), (3,'',NULL,BLOB), (9007199254740993,'-- DBMANAGER EXPORT COMPLETE','0.5',NULL)".replace('BLOB', blob))
        query(connection, 'CREATE TABLE t_big (id INTEGER PRIMARY KEY, v TEXT)')
        if driver == 'sqlite':
            query(connection, 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<500) INSERT INTO t_big(id, v) SELECT x, \'row\' || x FROM c')
        else:
            query(connection, "INSERT INTO t_big(id, v) SELECT g, 'row' || g FROM generate_series(1,500) AS g")
    print('W-P28 real: synthetic fixtures created (SQLite, PostgreSQL).', flush=True)


def cells_of(rows):
    """Normalise rows [[{kind,value}]] to the expected CELLS shape for the odd table."""
    out = []
    for row in rows:
        out.append([c.get('value') if c['kind'] != 'null' else None for c in row])
    return out


def check(ctx, pg):
    import html, re, xml.etree.ElementTree as ET
    import yaml
    dumps = Path(ctx['dumpDir'])
    for label in ('sqlite', 'postgresql'):
        files = {p.name.split('-', 2)[1]: p for p in dumps.glob(f'{label}-*')}
        expected = {r[0]: r for r in CELLS}
        # json-like profiles: yaml (strict JSON subset) and codegen lines
        doc = yaml.safe_load(files['yaml'].read_text(encoding='utf-8'))
        assert doc['complete'] is True and doc['format'] == 'dbmanager-export', label
        odd = next(t for t in doc['tables'] if t['table']['name'] == 'odd"name')
        got = cells_of(odd['rows'])
        assert [r[1] for r in got] == [expected[i][1] for i in ['1', '2', '3', '9007199254740993']], f'{label}: yaml text cells'
        assert [r[0] for r in got] == ['1', '2', '3', '9007199254740993'], f'{label}: yaml ids'
        lines = [json.loads(l) for l in files['codegen'].read_text(encoding='utf-8').splitlines()]
        assert lines[0]['format'] == 'dbmanager-codegen-text' and lines[-1] == {'complete': True}
        assert cells_of([l['row'] for l in lines if 'row' in l and l['row'][0]['value'] in expected])[0][1] == CELLS[0][1]
        # xml: independent parser, base64 text decoded where the backend marks it
        root = ET.fromstring(files['xml'].read_bytes())
        assert root.tag == 'export' and root.find('complete').text == 'true'
        tbl = next(t for t in root.findall('table') if t.find('name').text == 'odd"name')
        texts = [[c.find('value').text or '' for c in r.findall('cell')][1] for r in tbl.find('rows').findall('row')]
        assert texts[0] == CELLS[0][1] and texts[3] == '-- DBMANAGER EXPORT COMPLETE', f'{label}: xml text cells'
        # php: executed by php itself, tables returned as arrays
        php = subprocess.run(['php', '-r', 'echo json_encode(include $argv[1]);', str(files['php'])], capture_output=True, text=True)
        assert php.returncode == 0, php.stderr
        data = json.loads(php.stdout)
        assert data['complete'] is True and len(data['tables']) >= 1, f'{label}: php'
        # entity formats: reverse the numeric entities and compare with the codegen cells
        for key in ('mediawiki', 'texy'):
            text = files[key].read_text(encoding='utf-8')
            assert re.fullmatch(r'[\x20-\x7e\n]*', text), f'{label}: {key} has raw non-ASCII or control bytes'
            assert CELLS[0][1].replace('\\', '\\\\') in html.unescape(text).replace('\\n', '\n') or 'zeile2' in html.unescape(text), f'{label}: {key}'
            assert '<b>' not in text and '[[' not in text
        for key in ('latex', 'latexlongtable'):
            text = files[key].read_text(encoding='utf-8')
            assert text.rstrip().endswith('% DBMANAGER EXPORT COMPLETE'), f'{label}: {key} marker'
            assert '<b>' not in text and '\\%' in text and '\\$' in text and '\\_' in text and '\\#' in text, f'{label}: {key} escaping'
        assert not list(dumps.glob(f'{label}-cut-*')), f'{label}: an incomplete export was saved'
        print(f'W-P28 real: {label} extended formats re-read with independent parsers (ElementTree, PyYAML, php, json, entities, LaTeX markers).', flush=True)


def main():
    h.harness('w-p28', 'tests/real/export-formats.spec.ts', [21], prepare, check)


if __name__ == '__main__':
    h.guarded(main)
