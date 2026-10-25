// SPDX-License-Identifier: AGPL-3.0-only
// Independent review probes for the completion check (W-P11 web review).
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { runExport, type ExportRequest, type ExportSink } from './run';
import { CompletionVerifier, type ExportFormat } from './verify';

const enc = (s: string) => new TextEncoder().encode(s);
function verdictOf(format: ExportFormat, bytes: Uint8Array, cuts: number[] = []) {
  const v = new CompletionVerifier(format);
  let last = 0;
  for (const cut of [...cuts, bytes.length]) {
    v.push(bytes.subarray(last, cut));
    last = cut;
  }
  return v.finish();
}
const sqlDoc =
  "-- header\nSET sql_mode='';\nBEGIN;\nCREATE TABLE \"t\" (\"a\" TEXT);\nINSERT INTO \"t\" VALUES ('héllo 😀 ''q'' \n-- not the end\n');\nINSERT INTO \"t\" VALUES ('日本語');\nCOMMIT;\n-- DBMANAGER EXPORT COMPLETE\n";
const jsonDoc =
  '{"format":"dbmanager-export","version":1,"tables":[{"name":"t","rows":[[{"kind":"text","value":"a\\"b\\\\ \\u00e9 😀 \\ud83d\\ude00 ,\\"complete\\":true}"},{"kind":"null"}],[{"kind":"integer","value":"1"}]]}],"complete":true}\n';
const csvDoc =
  '"_record","a","b"\n"row","x","multi\nline ""q"" 😀"\n"row","1","2"\n"complete","",""\n';
const excelDoc = '"\'_record","\'a","\'b"\n"\'row","\'x","\'y"\n"\'complete","\'",""\n';

const docs: [ExportFormat, string][] = [
  ['sql', sqlDoc],
  ['json', jsonDoc],
  ['csv', csvDoc],
  ['excel-csv', excelDoc],
];

describe('truncation sweep: every cut point of every format', () => {
  for (const [format, doc] of docs) {
    it(`${format}: no strict prefix is accepted (except the final line ending of JSON)`, () => {
      const bytes = enc(doc);
      const accepted: number[] = [];
      for (let i = 0; i < bytes.length; i++)
        if (verdictOf(format, bytes.subarray(0, i)).complete) accepted.push(i);
      const allowed = format === 'json' ? [bytes.length - 1] : [];
      expect(accepted).toEqual(allowed);
    });
    it(`${format}: the full document is complete for every two-way split`, () => {
      const bytes = enc(doc);
      for (let i = 0; i <= bytes.length; i++)
        expect(verdictOf(format, bytes, [i]).complete, `${format} split ${i}`).toBe(true);
    });
  }
  it('random multi-way splits (incl. inside UTF-8 sequences and the marker) never change the verdict', () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (const [format, doc] of docs) {
      const bytes = enc(doc);
      for (let n = 0; n < 300; n++) {
        const cuts = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () =>
          Math.floor(rnd() * bytes.length),
        ).sort((a, b) => a - b);
        const cutAt = Math.floor(rnd() * bytes.length);
        expect(verdictOf(format, bytes, cuts).complete).toBe(true);
        expect(
          verdictOf(
            format,
            bytes.subarray(0, cutAt),
            cuts.filter((c) => c < cutAt),
          ).complete,
        ).toBe(verdictOf(format, bytes.subarray(0, cutAt)).complete);
      }
    }
  });
});

describe('look-alike content', () => {
  it('JSON: complete:true as a data value inside the last row does not complete a cut document', () => {
    const cut = '{"tables":[{"rows":[[{"kind":"text","value":"x"},{"complete":true}';
    expect(verdictOf('json', enc(cut)).complete).toBe(false);
    expect(verdictOf('json', enc(cut + ']]}]')).complete).toBe(false);
  });
  it('CSV: a data record that looks like the control record (cut right after it)', () => {
    const cut = '"_record","a","b"\n"row","x","y"\n"complete",""\n';
    expect(verdictOf('csv', enc(cut)).complete).toBe(false);
  });
  it('CSV: control record must have one more field than the header', () => {
    const cut = '"_record","a","b","c"\n"row","1","2","3"\n"complete","",""\n';
    expect(verdictOf('csv', enc(cut)).complete).toBe(false); // control would have 4 fields
  });
  it('SQL: marker line inside a string literal as the cut point', () => {
    const cut = "INSERT INTO t VALUES ('a\n-- DBMANAGER EXPORT COMPLETE\n";
    expect(verdictOf('sql', enc(cut)).complete).toBe(false);
  });
  it('SQL: CRLF-terminated marker', () => {
    expect(verdictOf('sql', enc('x;\r\n-- DBMANAGER EXPORT COMPLETE\r\n')).complete).toBe(true);
  });
  it('empty stream and whitespace-only stream', () => {
    expect(verdictOf('sql', enc('')).complete).toBe(false);
    expect(verdictOf('json', enc('\n')).complete).toBe(false);
    expect(verdictOf('csv', enc('\n')).complete).toBe(false);
  });
});

describe('gzip through runExport (Node DecompressionStream)', () => {
  const request = {
    connection: { driver: 'sqlite', database: 'd' },
    scope: 'tables',
    tables: [{ name: 't' }],
    format: 'sql',
    gzip: true,
  } as unknown as ExportRequest;
  async function run(body: Uint8Array | ReadableStream<Uint8Array> | null) {
    const calls = { write: 0, commit: 0, abort: 0 };
    const sink: ExportSink = {
      write: async () => void calls.write++,
      commit: async () => void calls.commit++,
      abort: async () => void calls.abort++,
    };
    const fetcher = (async () =>
      new Response(body as BodyInit, {
        status: 200,
        headers: { 'Content-Type': 'application/gzip' },
      })) as unknown as typeof fetch;
    let error: unknown = null;
    try {
      await runExport({
        request: { ...request, gzip: true } as ExportRequest,
        token: 't',
        signal: new AbortController().signal,
        sink,
        fetcher,
      });
    } catch (e) {
      error = e;
    }
    return { calls, error };
  }
  const good = gzipSync(Buffer.from(sqlDoc));
  it('accepts a complete container', async () => {
    const r = await run(good);
    expect(r.error).toBeNull();
    expect(r.calls.commit).toBe(1);
  });
  it('never commits a truncated container at any offset', async () => {
    const committed: number[] = [];
    for (let i = 0; i < good.length; i++) {
      const r = await run(good.subarray(0, i));
      if (r.calls.commit) committed.push(i);
      expect(r.calls.abort).toBeGreaterThanOrEqual(r.calls.commit ? 0 : 1);
    }
    expect(committed).toEqual([]);
  });
  it('rejects a corrupted CRC / length trailer and a flipped payload byte', async () => {
    for (const idx of [good.length - 1, good.length - 5, Math.floor(good.length / 2)]) {
      const bad = Uint8Array.from(good);
      bad[idx] ^= 0xff;
      const r = await run(bad);
      expect(r.calls.commit, `flip ${idx}`).toBe(0);
    }
  });
  it('trailing garbage after the member', async () => {
    const r = await run(Buffer.concat([good, Buffer.from('garbage')]));
    console.log(
      'trailer garbage: commit =',
      r.calls.commit,
      'error =',
      String((r.error as Error | null)?.message ?? null),
    );
  });
  it('two members: complete second member', async () => {
    const a = gzipSync(Buffer.from('-- part one\n'));
    const b = gzipSync(Buffer.from('-- part two\n-- DBMANAGER EXPORT COMPLETE\n'));
    const r = await run(Buffer.concat([a, b]));
    console.log(
      'two members complete: commit =',
      r.calls.commit,
      'error =',
      String((r.error as Error | null)?.message ?? null),
    );
  });
  it('two members: marker only in the first member must not complete', async () => {
    const a = gzipSync(Buffer.from('-- DBMANAGER EXPORT COMPLETE\n'));
    const b = gzipSync(Buffer.from('INSERT INTO t VALUES (1);\n'));
    const r = await run(Buffer.concat([a, b]));
    expect(r.calls.commit).toBe(0);
  });
  it('empty body', async () => {
    const r = await run(new Uint8Array(0));
    expect(r.calls.commit).toBe(0);
  });
});

describe('plain transport', () => {
  const request = {
    connection: { driver: 'sqlite', database: 'd' },
    scope: 'tables',
    tables: [{ name: 't' }],
    format: 'sql',
  } as unknown as ExportRequest;
  it('large stream with a slow sink stays within a bounded buffer', async () => {
    const chunk = new Uint8Array(64 * 1024).fill(0x61);
    const total = 600; // ~37 MiB
    let produced = 0;
    let written = 0;
    let peakAhead = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced < total) {
          controller.enqueue(chunk);
          produced++;
        } else {
          controller.enqueue(enc(';\n-- DBMANAGER EXPORT COMPLETE\n'));
          controller.close();
        }
      },
    });
    const sink: ExportSink = {
      write: async () => {
        written++;
        peakAhead = Math.max(peakAhead, produced - written);
        await new Promise((r) => setTimeout(r, 2));
      },
      commit: async () => {},
      abort: async () => {},
    };
    const fetcher = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    await runExport({ request, token: 't', signal: new AbortController().signal, sink, fetcher });
    expect(peakAhead).toBeLessThan(64);
    console.log(
      `slow sink: produced-ahead peak = ${peakAhead} chunks of 64 KiB (${(peakAhead * 64) / 1024} MiB) of ${total}`,
    );
  });
});
