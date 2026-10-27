// SPDX-License-Identifier: AGPL-3.0-only
// Completion check of the extended formats (API 0.21). The samples are real backend bytes (SQLite,
// one table with one text column and the value `x<&`), captured from backend d9463ba.
import { describe, expect, it } from 'vitest';
import {
  buildRequest,
  defaultForm,
  EXTENDED_FORMATS,
  previewRows,
  notices,
  type ExportForm,
} from './options';
import { CompletionVerifier, type ExportFormat } from './verify';

const enc = (s: string) => new TextEncoder().encode(s);
const samples: Record<string, string> = {
  xml: '<?xml version="1.0" encoding="UTF-8"?>\n<export version="1">\n<table><database>fx</database><schema>main</schema><name>u</name><columns><column><name>a</name><database_type>TEXT</database_type></column></columns><rows>\n<row><cell><kind>text</kind><value>x&lt;&amp;</value></cell></row>\n</rows></table>\n<complete>true</complete></export>\n',
  yaml: '{"format":"dbmanager-export","version":1,"tables":[{"database":"fx","table":{"schema":"main","name":"u"},"columns":[{"name":"a","database_type":"TEXT"}],"rows":[[{"kind":"text","value":"x\\u003c\\u0026"}]]}],"complete":true}\n',
  'php-array':
    "<?php\nreturn array('tables'=>array(\narray('metadata'=>\"\\x7B\\x22\\x64\\x61\\x74\\x61\\x62\\x61\\x73\\x65\\x22\\x3A\\x22\\x66\\x78\\x22\\x2C\\x22\\x74\\x61\\x62\\x6C\\x65\\x22\\x3A\\x7B\\x22\\x73\\x63\\x68\\x65\\x6D\\x61\\x22\\x3A\\x22\\x6D\\x61\\x69\\x6E\\x22\\x2C\\x22\\x6E\\x61\\x6D\\x65\\x22\\x3A\\x22\\x75\\x22\\x7D\\x2C\\x22\\x63\\x6F\\x6C\\x75\\x6D\\x6E\\x73\\x22\\x3A\\x5B\\x7B\\x22\\x6E\\x61\\x6D\\x65\\x22\\x3A\\x22\\x61\\x22\\x2C\\x22\\x64\\x61\\x74\\x61\\x62\\x61\\x73\\x65\\x5F\\x74\\x79\\x70\\x65\\x22\\x3A\\x22\\x54\\x45\\x58\\x54\\x22\\x7D\\x5D\\x7D\",'rows'=>array(\narray(array('kind'=>\"\\x74\\x65\\x78\\x74\",'value'=>\"\\x78\\x3C\\x26\"),),\n)),\n),'complete'=>true);\n",
  latex:
    '% Table: fx:main.u\n\\begin{tabular}{l}\na \\\\\n\\{"kind":"text","value":"x\\textbackslash{}u003c\\textbackslash{}u0026"\\} \\\\\n\\end{tabular}\n% DBMANAGER EXPORT COMPLETE\n',
  'latex-longtable':
    '% Table: fx:main.u\n\\begin{longtable}{l}\na \\\\\n\\{"kind":"text","value":"x\\textbackslash{}u003c\\textbackslash{}u0026"\\} \\\\\n\\end{longtable}\n% DBMANAGER EXPORT COMPLETE\n',
  mediawiki:
    '{| class="wikitable"\n|+ &#102;&#120;&#58;&#109;&#97;&#105;&#110;&#46;&#117;\n|-\n| &#97;\n|-\n| &#123;&#34;&#107;&#105;&#110;&#100;&#34;&#58;&#34;&#116;&#101;&#120;&#116;&#34;&#44;&#34;&#118;&#97;&#108;&#117;&#101;&#34;&#58;&#34;&#120;&#92;&#117;&#48;&#48;&#51;&#99;&#92;&#117;&#48;&#48;&#50;&#54;&#34;&#125;\n|}\n<!-- DBMANAGER EXPORT COMPLETE -->\n',
  texy: '| &#97; |\n| &#123;&#34;&#107;&#105;&#110;&#100;&#34;&#58;&#34;&#116;&#101;&#120;&#116;&#34;&#44;&#34;&#118;&#97;&#108;&#117;&#101;&#34;&#58;&#34;&#120;&#92;&#117;&#48;&#48;&#51;&#99;&#92;&#117;&#48;&#48;&#50;&#54;&#34;&#125; |\n\n<!-- DBMANAGER EXPORT COMPLETE -->\n',
  codegen:
    '{"format":"dbmanager-codegen-text","version":1}\n{"table":{"database":"fx","table":{"schema":"main","name":"u"},"columns":[{"name":"a","database_type":"TEXT"}]}}\n{"row":[{"kind":"text","value":"x\\u003c\\u0026"}]}\n{"complete":true}\n',
};

function verdict(format: ExportFormat, text: string | Uint8Array, cuts: number[] = []) {
  const bytes = typeof text === 'string' ? enc(text) : text;
  const v = new CompletionVerifier(format);
  let last = 0;
  for (const cut of [...cuts, bytes.length]) {
    v.push(bytes.subarray(last, cut));
    last = cut;
  }
  return v.finish();
}

describe('extended formats: closing structure', () => {
  for (const format of EXTENDED_FORMATS) {
    const sample = samples[format];
    it(`${format}: the complete real export is accepted, also split at every byte`, () => {
      expect(verdict(format, sample).complete).toBe(true);
      const bytes = enc(sample);
      for (let i = 0; i <= bytes.length; i++)
        expect(verdict(format, bytes, [i]).complete, `${format} split ${i}`).toBe(true);
    });
    it(`${format}: no strict prefix is accepted`, () => {
      const bytes = enc(sample);
      for (let i = 0; i < bytes.length; i++)
        expect(verdict(format, bytes.subarray(0, i)).complete, `${format} cut ${i}`).toBe(false);
    });
    it(`${format}: an empty stream and trailing garbage are rejected`, () => {
      expect(verdict(format, '').complete).toBe(false);
      expect(verdict(format, `${sample}x`).complete).toBe(false);
    });
  }
  it('accepts a UTF-8 BOM in front of the document', () => {
    expect(verdict('xml', `\uFEFF${samples.xml}`).complete).toBe(true);
    expect(verdict('yaml', `\uFEFF${samples.yaml}`).complete).toBe(true);
  });
  it('does not take a marker-looking cell for the end (cut inside a string)', () => {
    expect(
      verdict(
        'yaml',
        '{"format":"dbmanager-export","version":1,"tables":[{"rows":[[{"kind":"text","value":"x],\\"complete\\":true}\n',
      ).complete,
    ).toBe(false);
    expect(
      verdict(
        'codegen',
        '{"format":"dbmanager-codegen-text","version":1}\n{"row":[{"kind":"text","value":"\\n{"complete":true}\n',
      ).complete,
    ).toBe(false);
    expect(
      verdict(
        'xml',
        '<?xml version="1.0" encoding="UTF-8"?>\n<export version="1">\n<table><rows>\n<row><cell><value>&lt;/table&gt;\n&lt;complete&gt;true&lt;/complete&gt;&lt;/export&gt;\n',
      ).complete,
    ).toBe(false);
  });
  it('a LaTeX or wiki document needs its own environment end, not just the comment', () => {
    expect(verdict('latex', '% DBMANAGER EXPORT COMPLETE\n').complete).toBe(false);
    expect(verdict('latex', samples['latex-longtable']).complete).toBe(false);
    expect(verdict('latex-longtable', samples.latex).complete).toBe(false);
    expect(verdict('mediawiki', '<!-- DBMANAGER EXPORT COMPLETE -->\n').complete).toBe(false);
    expect(verdict('xml', samples.yaml).complete).toBe(false);
  });
});

describe('extended export request', () => {
  const connection = { driver: 'sqlite' as const, database: 'x' };
  const base = (): ExportForm => ({
    ...defaultForm(),
    tables: [{ name: 'a' }, { schema: 'main', name: 'b' }],
  });
  const build = (form: ExportForm, extra = {}) =>
    buildRequest(form, {
      connection,
      streamsToDisk: true,
      catalogTables: 2,
      catalog: form.tables,
      ...extra,
    });

  it('builds a data-only request for each text format (no DDL fields)', () => {
    for (const format of EXTENDED_FORMATS) {
      const built = build({ ...base(), format });
      expect(built.problems).toEqual([]);
      expect(built.request).toMatchObject({ format, scope: 'tables' });
      for (const key of ['structure', 'drop', 'extended', 'data_statement', 'aliases'])
        expect(built.request).not.toHaveProperty(key);
    }
  });
  it('allows the text formats for server and query scope but not CSV for the server', () => {
    expect(
      build({ ...base(), scope: 'server', databases: 'a\nb', format: 'yaml' }).problems,
    ).toEqual([]);
    expect(
      build({ ...base(), scope: 'query', sql: 'select 1', format: 'codegen' }).problems,
    ).toEqual([]);
    expect(
      build({ ...base(), scope: 'server', databases: 'a', format: 'excel-csv' }).problems,
    ).not.toEqual([]);
  });
  it('refuses a text format on an instance that only speaks API 0.11', () => {
    expect(build({ ...base(), format: 'xml' }, { api: 'v11' }).request).toBeNull();
  });
  it('maps dump details and rejects contradictions before sending', () => {
    const sql = {
      ...base(),
      viewsAsTables: true,
      comments: true,
      dataStatement: 'replace' as const,
    };
    expect(build(sql).request).toMatchObject({
      views_as_tables: true,
      comments: true,
      data_statement: 'replace',
    });
    const dataOnly = { ...base(), compatibility: 'data-only' as const };
    expect(build(dataOnly).request).toBeNull();
    expect(build({ ...dataOnly, structure: false }).request).toMatchObject({
      compatibility: 'data-only',
      structure: false,
    });
    const pg = { driver: 'postgres' as const, database: 'x' } as never;
    expect(build({ ...base(), dataStatement: 'replace' }, { connection: pg }).request).toBeNull();
  });
  it('builds aliases only for selected tables, without structure and with unique targets', () => {
    const form = { ...base(), structure: false, aliases: { '\u0000a': 'main\u0000b' } };
    expect(build(form).request?.aliases).toEqual([
      { source: { name: 'a' }, target: { schema: 'main', name: 'b' } },
    ]);
    expect(build({ ...form, structure: true }).request).toBeNull();
    expect(
      build({ ...form, aliases: { '\u0000a': 'main\u0000b', 'main\u0000b': 'main\u0000b' } })
        .request,
    ).toBeNull();
    expect(build({ ...form, aliases: { '\u0000a': 'main\u0000gone' } }).request).toBeNull();
    // An alias of a table that is no longer selected is dropped silently.
    expect(build({ ...form, tables: [{ schema: 'main', name: 'b' }] }).request).not.toHaveProperty(
      'aliases',
    );
  });
  it('describes the text format in the preview and warns about its limits', () => {
    const built = build({ ...base(), format: 'php-array' });
    expect(previewRows(built.request!, true).some((row) => row.value === 'PHP-Array')).toBe(true);
    expect(notices(built.request!, 'sqlite').join(' ')).toContain('include');
  });
});
