// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import provenance from '$lib/contract/v11/provenance.json';
import { buildRequest, defaultForm, parseDatabases } from './options';
import { ExportError, runExport, safeFilename, type ExportRequest, type ExportSink } from './run';
import { MemorySink } from './sinks';
import { CompletionVerifier, type ExportFormat } from './verify';

const enc = (text: string) => new TextEncoder().encode(text);
function verdict(format: ExportFormat, text: string | Uint8Array, chunk = 7) {
  const verifier = new CompletionVerifier(format);
  const bytes = typeof text === 'string' ? enc(text) : text;
  for (let i = 0; i < bytes.length; i += chunk) verifier.push(bytes.subarray(i, i + chunk));
  return verifier.finish();
}

describe('vendored contract 0.11.0', () => {
  it('matches the reviewed bytes', () => {
    const bytes = readFileSync('src/lib/contract/v11/api-v0.11.0.json');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.sha256);
    expect(provenance.sha256).toBe(
      'b3bcc38b44b020335151aead207e281f9c54bdc7463d6fb1ddd7a6cc22396620',
    );
  });
});

describe('closing marker: SQL', () => {
  const body = 'CREATE TABLE t(a);\nINSERT INTO t VALUES (1);\n';
  it('accepts the marker line, also split over chunks and with CRLF', () => {
    expect(verdict('sql', `${body}-- DBMANAGER EXPORT COMPLETE\n`, 3).complete).toBe(true);
    expect(verdict('sql', `${body}-- DBMANAGER EXPORT COMPLETE\n`, 1).complete).toBe(true);
    expect(verdict('sql', '-- DBMANAGER EXPORT COMPLETE\n').complete).toBe(true);
  });
  it('rejects missing, truncated, unterminated, empty and embedded markers', () => {
    expect(verdict('sql', body).complete).toBe(false);
    expect(verdict('sql', `${body}-- DBMANAGER EXPORT COMPL`).complete).toBe(false);
    expect(verdict('sql', `${body}-- DBMANAGER EXPORT COMPLETE`).complete).toBe(false);
    expect(verdict('sql', `${body}x-- DBMANAGER EXPORT COMPLETE\n`).complete).toBe(false);
    expect(verdict('sql', `${body}-- DBMANAGER EXPORT COMPLETE\nINSERT`).complete).toBe(false);
    expect(verdict('sql', '')).toEqual({ complete: false, reason: 'empty' });
  });
});

describe('closing marker: JSON', () => {
  const doc =
    '{"format":"dbmanager-export","version":1,"snapshot":"per_database","tables":[{"rows":[[{"kind":"text","value":"a\\"}],\\""}]]}],"complete":true}\n';
  it('accepts a balanced document ending with complete:true', () => {
    expect(verdict('json', doc, 5).complete).toBe(true);
  });
  it('rejects cut, unbalanced, missing and look-alike documents', () => {
    expect(verdict('json', doc.slice(0, -12)).complete).toBe(false);
    expect(verdict('json', '{"format":"dbmanager-export","tables":[').complete).toBe(false);
    expect(verdict('json', '{"tables":[],"complete":false}\n').complete).toBe(false);
    expect(verdict('json', '{"tables":[{"rows":[["x,\\"complete\\":true}')).toMatchObject({
      complete: false,
    });
    expect(verdict('json', '{"tables":[]}\n').complete).toBe(false);
    expect(verdict('json', '{"tables":["abc,"complete":true}').complete).toBe(false);
  });
});

describe('closing marker: CSV', () => {
  const header = '"_record","a","b"\n';
  const control = '"complete","",""\n';
  it('accepts the control record, also for the excel profile and CRLF', () => {
    expect(verdict('csv', `${header}"row","1","x"\n${control}`, 4).complete).toBe(true);
    expect(verdict('csv', `${header}${control}`).complete).toBe(true);
    expect(
      verdict('excel-csv', `"'_record","'a"\r\n"'row","'1"\r\n"'complete","'"\r\n`).complete,
    ).toBe(true);
  });
  it('rejects streams without control record or cut inside a record', () => {
    expect(verdict('csv', `${header}"row","1","x"\n`).complete).toBe(false);
    expect(verdict('csv', `${header}"row","1","x"\n"complete","",`).complete).toBe(false);
    expect(verdict('csv', `${header}"row","1","x"\n"complete","",""`).complete).toBe(false);
    expect(verdict('csv', `${header}"row","1","line\n${control}`).complete).toBe(false);
    expect(verdict('csv', header).complete).toBe(false);
  });
  it('does not take a control-looking line inside a quoted field for the end', () => {
    expect(verdict('csv', `${header}"row","a\n"complete","",""\n`).complete).toBe(false);
  });
});

describe('safeFilename', () => {
  it('reduces to a harmless base name', () => {
    expect(safeFilename('attachment; filename="export.sql"', 'x')).toBe('export.sql');
    expect(safeFilename('attachment; filename="../../etc/passwd"', 'x')).toBe('passwd');
    expect(safeFilename('attachment; filename="a b\u0000c.sql"', 'x')).toBe('a_b_c.sql');
    expect(safeFilename('attachment; filename="..\\\\evil.sql"', 'x')).toBe('evil.sql');
    expect(safeFilename('attachment; filename=".hidden"', 'x')).toBe('hidden');
    expect(safeFilename(null, 'export.json')).toBe('export.json');
    expect(safeFilename('attachment; filename=""', 'fallback.sql')).toBe('fallback.sql');
  });
});

class TestSink implements ExportSink {
  written = 0;
  committed: string | null = null;
  aborted = false;
  async write(chunk: Uint8Array) {
    this.written += chunk.length;
  }
  async commit(name: string) {
    this.committed = name;
  }
  async abort() {
    this.aborted = true;
  }
}
const request = (over: Partial<ExportRequest> = {}): ExportRequest => ({
  connection: { driver: 'sqlite', database: 'synthetic' },
  format: 'sql',
  scope: 'tables',
  tables: [{ name: 't' }],
  ...over,
});
function streamOf(parts: (string | Uint8Array)[], fail?: Error): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < parts.length) {
        const part = parts[i++];
        controller.enqueue(typeof part === 'string' ? enc(part) : part);
      } else if (fail) controller.error(fail);
      else controller.close();
    },
  });
}
const respond = (body: ReadableStream<Uint8Array> | string, init: ResponseInit = {}) =>
  (async () =>
    new Response(body, {
      status: 200,
      headers: { 'Content-Disposition': 'attachment; filename="export.sql"' },
      ...init,
    })) as unknown as typeof fetch;

describe('runExport', () => {
  const ok = 'CREATE TABLE t(a);\n-- DBMANAGER EXPORT COMPLETE\n';
  it('commits a verified export and sends the token only as header', async () => {
    const sink = new TestSink();
    let seen: { url: string; init: RequestInit } | null = null;
    const fetcher = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(streamOf([ok.slice(0, 10), ok.slice(10)]), {
        headers: {
          'Content-Disposition': 'attachment; filename="export.sql"',
          'X-Export-Snapshot': 'per-database',
        },
      });
    }) as unknown as typeof fetch;
    const result = await runExport({
      request: request(),
      token: 'secret-token',
      signal: new AbortController().signal,
      sink,
      fetcher,
    });
    expect(result).toMatchObject({
      filename: 'export.sql',
      rawBytes: ok.length,
      snapshot: 'per-database',
    });
    expect(sink.committed).toBe('export.sql');
    expect(sink.aborted).toBe(false);
    expect(seen!.url).toBe('/api/v11/export');
    expect(seen!.url).not.toContain('secret');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer secret-token',
    );
  });

  it('reports a 200 stream without closing marker as incomplete and never commits', async () => {
    const sink = new TestSink();
    await expect(
      runExport({
        request: request(),
        token: 't',
        signal: new AbortController().signal,
        sink,
        fetcher: respond(streamOf(['CREATE TABLE t(a);\nINSERT INTO t VALUES (1);\n'])),
      }),
    ).rejects.toMatchObject({ kind: 'incomplete' });
    expect(sink.committed).toBeNull();
    expect(sink.aborted).toBe(true);
  });

  it('treats a cut connection (stream error) as incomplete', async () => {
    const sink = new TestSink();
    await expect(
      runExport({
        request: request(),
        token: 't',
        signal: new AbortController().signal,
        sink,
        fetcher: respond(streamOf(['CREATE'], new TypeError('network error'))),
      }),
    ).rejects.toBeInstanceOf(ExportError);
    expect(sink.committed).toBeNull();
    expect(sink.aborted).toBe(true);
  });

  it('verifies gzip content and rejects a truncated container', async () => {
    const sink = new TestSink();
    const good = gzipSync(Buffer.from(ok));
    const done = await runExport({
      request: request({ gzip: true }),
      token: 't',
      signal: new AbortController().signal,
      sink,
      fetcher: respond(streamOf([good.subarray(0, 9), good.subarray(9)]), {
        headers: { 'Content-Disposition': 'attachment; filename="export.sql.gz"' },
      }),
    });
    expect(done.filename).toBe('export.sql.gz');
    expect(done.decodedBytes).toBe(ok.length);
    const bad = new TestSink();
    await expect(
      runExport({
        request: request({ gzip: true }),
        token: 't',
        signal: new AbortController().signal,
        sink: bad,
        fetcher: respond(streamOf([good.subarray(0, good.length - 6)])),
      }),
    ).rejects.toMatchObject({ kind: 'incomplete' });
    expect(bad.committed).toBeNull();
    const noMarker = new TestSink();
    await expect(
      runExport({
        request: request({ gzip: true }),
        token: 't',
        signal: new AbortController().signal,
        sink: noMarker,
        fetcher: respond(streamOf([gzipSync(Buffer.from('CREATE TABLE t(a);\n'))])),
      }),
    ).rejects.toMatchObject({ kind: 'incomplete', code: 'no_marker' });
    expect(noMarker.committed).toBeNull();
  });

  it('explains export_busy and other pre-stream errors in German', async () => {
    const sink = new TestSink();
    const busy = respond(JSON.stringify({ error: { code: 'export_busy', message: 'x' } }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
    await expect(
      runExport({
        request: request(),
        token: 't',
        signal: new AbortController().signal,
        sink,
        fetcher: busy,
      }),
    ).rejects.toMatchObject({
      kind: 'rejected',
      code: 'export_busy',
      message: expect.stringContaining('zwei Exporte'),
    });
    const limit = respond(JSON.stringify({ error: { code: 'export_row_limit', message: 'x' } }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
    await expect(
      runExport({
        request: request(),
        token: 't',
        signal: new AbortController().signal,
        sink,
        fetcher: limit,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('Zeilenlimit') });
    expect(sink.committed).toBeNull();
  });

  it('cancels on abort and discards the output', async () => {
    const sink = new TestSink();
    const controller = new AbortController();
    const hanging = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc('CREATE TABLE'));
      },
    });
    const fetcher = (async (_url: string, init: RequestInit) => {
      init.signal?.addEventListener('abort', () => undefined);
      return new Response(hanging, {
        headers: { 'Content-Disposition': 'attachment; filename="export.sql"' },
      });
    }) as unknown as typeof fetch;
    const promise = runExport({
      request: request(),
      token: 't',
      signal: controller.signal,
      sink,
      fetcher,
    });
    setTimeout(() => controller.abort(), 20);
    await expect(promise).rejects.toMatchObject({ kind: 'canceled' });
    expect(sink.committed).toBeNull();
    expect(sink.aborted).toBe(true);
  });

  it('rejects invalid requests before any network call', async () => {
    const sink = new TestSink();
    let called = false;
    const fetcher = (async () => ((called = true), new Response(''))) as unknown as typeof fetch;
    await expect(
      runExport({
        request: request({ tables: [] }),
        token: 't',
        signal: new AbortController().signal,
        sink,
        fetcher,
      }),
    ).rejects.toMatchObject({ code: 'invalid_export' });
    expect(called).toBe(false);
  });

  it('stops a memory download that exceeds the client limit', async () => {
    const sink = new MemorySink('application/sql', { deliver: () => undefined }, 8);
    await expect(
      runExport({
        request: request(),
        token: 't',
        signal: new AbortController().signal,
        sink,
        fetcher: respond(streamOf([ok])),
      }),
    ).rejects.toMatchObject({ kind: 'client_limit' });
  });
});

describe('request building', () => {
  const context = (
    driver: 'sqlite' | 'mysql' | 'postgres' = 'sqlite',
    streamsToDisk = true,
    catalogTables = 2,
  ) => ({ connection: { driver, database: 'd' } as never, streamsToDisk, catalogTables });
  const form = (over = {}) => ({ ...defaultForm(), tables: [{ name: 'a' }], ...over });
  it('produces contract-valid requests and omits unset fields', () => {
    const built = buildRequest(
      form({ maxMiB: '10', timeoutS: '30', gzip: true, filename: 'dump' }),
      context(),
    );
    expect(built.problems).toEqual([]);
    expect(built.request).toMatchObject({
      format: 'sql',
      scope: 'tables',
      structure: true,
      data: true,
      gzip: true,
      filename: 'dump',
      max_bytes: 10 * 1024 * 1024,
      timeout_ms: 30000,
    });
    expect(built.request).not.toHaveProperty('max_rows');
    expect(built.request).not.toHaveProperty('delimiter');
  });
  it('reports problems in German instead of sending', () => {
    expect(buildRequest(form({ tables: [] }), context()).problems[0]).toContain('Tabelle');
    expect(
      buildRequest(form({ format: 'csv', tables: [{ name: 'a' }, { name: 'b' }] }), context())
        .problems[0],
    ).toContain('genau eine');
    expect(buildRequest(form({ disableFk: true }), context('postgres')).problems[0]).toContain(
      'PostgreSQL',
    );
    expect(buildRequest(form({ structure: false, data: false }), context()).problems[0]).toContain(
      'Struktur',
    );
    expect(
      buildRequest(form({ scope: 'query', format: 'sql', sql: 'select 1' }), context()).problems[0],
    ).toContain('CSV');
    expect(buildRequest(form({ filename: '../x' }), context()).problems[0]).toContain('Dateiname');
    expect(buildRequest(form({ maxRows: 'abc' }), context()).problems[0]).toContain('Zeilengrenze');
    expect(buildRequest(form({ maxMiB: '512' }), context('sqlite', false)).problems[0]).toContain(
      '256',
    );
    expect(buildRequest(form({ maxMiB: '512' }), context('sqlite', true)).problems).toEqual([]);
    expect(
      buildRequest(form({ scope: 'server', databases: 'a', format: 'sql' }), context('postgres'))
        .problems[0],
    ).toContain('MySQL');
  });
  it('builds query, server and database scopes', () => {
    expect(
      buildRequest(form({ scope: 'query', format: 'json', sql: 'select 1' }), context()).request,
    ).toMatchObject({ scope: 'query', sql: 'select 1' });
    expect(
      buildRequest(form({ scope: 'server', format: 'sql', databases: 'a\nb\na' }), context('mysql'))
        .request,
    ).toMatchObject({ databases: ['a', 'b'] });
    expect(buildRequest(form({ scope: 'database' }), context()).request).not.toHaveProperty(
      'tables',
    );
    expect(parseDatabases(' a \n\nb')).toEqual(['a', 'b']);
  });
});
