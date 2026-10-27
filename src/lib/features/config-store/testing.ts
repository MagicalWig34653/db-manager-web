// SPDX-License-Identifier: AGPL-3.0-only
// In-memory stand-in for the backend configuration store (API 0.24) used by unit and browser tests. It mirrors the
// documented behavior (versions, If-Match, opt-in, idempotent client_ref, cursor pages, import, clear plans) but is
// NOT the real server; the real behavior is exercised by scripts/test-real-config-store.py. No imports from $lib so
// that Playwright specs can load it directly.
type Json = Record<string, unknown>;
interface Rec {
  id: string;
  kind: string;
  scope: string;
  key: string;
  client_ref: string;
  version: number;
  created_at: string;
  updated_at: string;
  data: Json;
  seq: number;
}
export interface Call {
  method: string;
  path: string;
  body?: Json;
  ifMatch?: string | null;
}
const KINDS = ['history', 'bookmarks', 'searches', 'favorites', 'recents', 'settings', 'layouts'];
const LIMITS: Record<string, [boolean, boolean, number, number, number]> = {
  history: [false, true, 200, 5000, 263168],
  bookmarks: [false, false, 200, 2000, 266240],
  searches: [false, false, 100, 1000, 32768],
  favorites: [false, false, 500, 5000, 2048],
  recents: [false, true, 100, 500, 2048],
  settings: [true, false, 100, 200, 32768],
  layouts: [true, false, 1000, 2000, 65536],
};
// Rough stand-in for the server's secret rejection (the real rules are much broader).
const SECRET = /password|passwd|secret|token|api[_-]?key|bearer|rejectme/i;
const hex = (n: number) => n.toString(16).padStart(32, '0');
const iso = (ms: number) => new Date(ms).toISOString();

export class FakeConfigServer {
  token = 'test-token';
  /** Capabilities answer: server | not_configured | unreachable | missing (older backend, 404). */
  state: 'server' | 'not_configured' | 'unreachable' | 'missing' = 'server';
  /** Data routes answer 503 state_unavailable while true (capabilities then say unreachable). */
  down = false;
  /** Simulate a lost answer: the request is applied but the client gets a network error. */
  loseNextWriteAnswer = false;
  failNetwork = false;
  /** Bookmark limit per scope to test quota_exceeded (default 200 like the server). */
  limitOverride: Record<string, number> = {};
  items = new Map<string, Rec>();
  calls: Call[] = [];
  private seq = 0;
  private clock = Date.parse('2026-10-27T10:00:00.000Z');

  get fetch(): typeof fetch {
    return async (input, init) => {
      const url = new URL(String(input), 'http://localhost');
      const headers = new Headers(init?.headers);
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Json) : undefined;
      this.calls.push({
        method,
        path: url.pathname + url.search,
        body,
        ifMatch: headers.get('If-Match'),
      });
      if (this.failNetwork) throw new TypeError('network down');
      const answer = this.handle(method, url, headers, body);
      if (this.loseNextWriteAnswer && method !== 'GET') {
        this.loseNextWriteAnswer = false;
        throw new TypeError('connection lost');
      }
      return new Response(answer.json === undefined ? null : JSON.stringify(answer.json), {
        status: answer.status,
        headers: {
          ...(answer.json === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(answer.status === 503 ? { 'Retry-After': '5' } : {}),
        },
      });
    };
  }
  count(kind: string, scope?: string) {
    return [...this.items.values()].filter(
      (i) => i.kind === kind && (scope === undefined || i.scope === scope),
    ).length;
  }
  writes() {
    return this.calls.filter((c) => c.method !== 'GET');
  }
  private error(status: number, code: string) {
    return { status, json: { error: { code, message: 'x' } } };
  }
  private view(rec: Rec) {
    const { seq: _seq, ...item } = rec;
    return { ...item, key: item.key.includes('\0') ? '' : item.key };
  }
  private privacyOn() {
    const doc = [...this.items.values()].find((i) => i.kind === 'settings' && i.key === 'privacy');
    return doc?.data.history_enabled === true;
  }
  private caps() {
    const ok = this.state === 'server' && !this.down;
    return {
      contract_version: '0.24.0',
      available: ok,
      mode: ok ? 'server' : 'local_only',
      reason: ok ? 'ok' : this.state === 'not_configured' ? 'not_configured' : 'unreachable',
      owner_model: 'single',
      history_requires_opt_in: true,
      secrets_policy: 'reject',
      kinds: KINDS.map((kind) => ({
        kind,
        keyed: LIMITS[kind][0],
        fifo: LIMITS[kind][1],
        max_per_scope: this.limitOverride[kind] ?? LIMITS[kind][2],
        max_per_owner: LIMITS[kind][3],
        max_item_bytes: LIMITS[kind][4],
      })),
      max_owner_bytes: 33554432,
      max_page: 100,
      default_page: 50,
      max_import_items: 100,
      max_request_bytes: 1048576,
    };
  }
  private touch(rec: Rec) {
    rec.updated_at = iso((this.clock += 1000));
    rec.seq = ++this.seq;
  }
  private insert(kind: string, b: Json): { rec?: Rec; created: boolean; code?: [number, string] } {
    const scope = (b.scope as string) ?? '';
    const data = b.data as Json;
    if (SECRET.test(JSON.stringify(data)) || SECRET.test(String(b.key ?? '')))
      return { created: false, code: [422, 'secret_rejected'] };
    if (kind === 'history' && !this.privacyOn())
      return { created: false, code: [409, 'history_disabled'] };
    const key =
      (b.key as string) ??
      (LIMITS[kind][0]
        ? ''
        : kind === 'favorites' || kind === 'recents'
          ? `${data.database ?? ''}\0${data.table}`
          : '');
    if (LIMITS[kind][0] && !b.key) return { created: false, code: [400, 'invalid_request'] };
    const ref = (b.client_ref as string) ?? '';
    const same = [...this.items.values()].find(
      (i) =>
        i.kind === kind &&
        i.scope === scope &&
        ((ref && i.client_ref === ref) ||
          ((kind === 'favorites' || kind === 'recents' || LIMITS[kind][0]) && i.key === key)),
    );
    if (same) {
      if (LIMITS[kind][0]) return { created: false, code: [409, 'already_exists'] };
      if (kind === 'recents') {
        same.version++;
        this.touch(same);
      }
      return { rec: same, created: false };
    }
    const here = [...this.items.values()].filter((i) => i.kind === kind && i.scope === scope);
    const max = this.limitOverride[kind] ?? LIMITS[kind][2];
    if (here.length >= max) {
      if (!LIMITS[kind][1]) return { created: false, code: [409, 'quota_exceeded'] };
      const oldest = here.sort((a, c) => a.seq - c.seq)[0];
      this.items.delete(oldest.id);
    }
    const rec: Rec = {
      id: hex(++this.seq + 1000),
      kind,
      scope,
      key,
      client_ref: ref,
      version: 1,
      created_at: iso(this.clock),
      updated_at: iso(this.clock),
      data,
      seq: this.seq,
    };
    this.touch(rec);
    rec.created_at = rec.updated_at;
    this.items.set(rec.id, rec);
    return { rec, created: true };
  }
  private handle(
    method: string,
    url: URL,
    headers: Headers,
    body?: Json,
  ): { status: number; json?: unknown } {
    const path = url.pathname;
    if (headers.get('Authorization') !== `Bearer ${this.token}`)
      return this.error(401, 'unauthorized');
    if (path === '/api/v24/capabilities') {
      if (this.state === 'missing') return this.error(404, 'not_found');
      return { status: 200, json: this.caps() };
    }
    if (this.state !== 'server' || this.down) return this.error(503, 'state_unavailable');
    const parts = path.replace('/api/v24/config/', '').split('/');
    if (path === '/api/v24/config/status') {
      const usage = KINDS.map((kind) => ({
        kind,
        count: this.count(kind),
        bytes: this.count(kind) * 100,
        max_items: LIMITS[kind][3],
      }));
      return {
        status: 200,
        json: {
          schema_version: 2,
          usage,
          total_bytes: this.items.size * 100,
          max_owner_bytes: 33554432,
        },
      };
    }
    if (path === '/api/v24/config/export')
      return {
        status: 200,
        json: {
          format: 'dbm-config-export',
          format_version: 1,
          exported_at: iso(this.clock),
          items: [...this.items.values()].map((i) => ({
            kind: i.kind,
            scope: i.scope,
            key: i.key,
            client_ref: i.client_ref || `ex${i.id}`.slice(0, 40),
            time: i.created_at,
            data: i.data,
          })),
        },
      };
    if (path === '/api/v24/config/import' && method === 'POST') return this.importBatch(body!);
    if (path === '/api/v24/config/clear/plan' && method === 'POST') return this.plan(body!);
    if (path === '/api/v24/config/clear/execute' && method === 'POST') return this.execute(body!);
    const kind = parts[0];
    if (!KINDS.includes(kind)) return this.error(404, 'unknown_kind');
    if (parts.length === 1 && method === 'GET') {
      const scope = url.searchParams.get('scope');
      const key = url.searchParams.get('key');
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 100);
      const offset = Number(url.searchParams.get('cursor') || 0);
      const all = [...this.items.values()]
        .filter(
          (i) =>
            i.kind === kind &&
            (scope === null || i.scope === scope) &&
            (key === null || i.key === key),
        )
        .sort((a, b) => b.seq - a.seq);
      const page = all.slice(offset, offset + limit);
      return {
        status: 200,
        json: {
          items: page.map((i) => this.view(i)),
          next_cursor: offset + limit < all.length ? String(offset + limit) : '',
        },
      };
    }
    if (parts.length === 1 && method === 'POST') {
      const r = this.insert(kind, body!);
      if (r.code) return this.error(r.code[0], r.code[1]);
      return { status: r.created ? 201 : 200, json: this.view(r.rec!) };
    }
    const rec = this.items.get(parts[1]);
    if (!rec || rec.kind !== kind) return this.error(404, 'not_found');
    if (method === 'GET') return { status: 200, json: this.view(rec) };
    const match = headers.get('If-Match');
    if (match === null) return this.error(428, 'precondition_required');
    if (match !== '*' && match !== `"${rec.version}"`) return this.error(412, 'version_conflict');
    if (method === 'DELETE') {
      this.items.delete(rec.id);
      return { status: 204 };
    }
    if (method === 'PUT') {
      const data = body!.data as Json;
      if (SECRET.test(JSON.stringify(data))) return this.error(422, 'secret_rejected');
      rec.data = data;
      rec.version++;
      this.touch(rec);
      return { status: 200, json: this.view(rec) };
    }
    return this.error(400, 'invalid_request');
  }
  private importBatch(body: Json) {
    const items = body.items as Json[];
    const results = items.map((item, index) => {
      const r = this.insert(item.kind as string, item);
      if (r.code) return { index, status: 'rejected', id: '', reason: r.code[1] };
      if (r.created && item.time)
        r.rec!.created_at = String(item.time).replace(/(\.\d{3})?Z?$/, '.000Z');
      return { index, status: r.created ? 'created' : 'exists', id: r.rec!.id, reason: '' };
    });
    const n = (s: string) => results.filter((r) => r.status === s).length;
    return {
      status: 200,
      json: {
        results,
        created: n('created'),
        exists: n('exists'),
        updated: 0,
        rejected: n('rejected'),
      },
    };
  }
  private selection(body: Json) {
    const kinds = body.kinds as string[];
    const scope = body.scope as string | undefined;
    return [...this.items.values()].filter(
      (i) => kinds.includes(i.kind) && (scope === undefined || i.scope === scope),
    );
  }
  private hash(rows: Rec[]) {
    const text = rows
      .map((r) => `${r.id}:${r.version}`)
      .sort()
      .join(',');
    let h = 0;
    for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h.toString(16).padStart(8, '0').repeat(8);
  }
  private plan(body: Json) {
    const rows = this.selection(body);
    const kinds = body.kinds as string[];
    return {
      status: 200,
      json: {
        kinds: kinds.map((kind) => ({
          kind,
          count: rows.filter((r) => r.kind === kind).length,
          bytes: rows.filter((r) => r.kind === kind).length * 100,
        })),
        total_items: rows.length,
        total_bytes: rows.length * 100,
        plan_hash: this.hash(rows),
        confirmation: `LÖSCHEN ${rows.length}`,
      },
    };
  }
  private execute(body: Json) {
    const rows = this.selection(body);
    if (body.plan_hash !== this.hash(rows)) return this.error(409, 'plan_stale');
    if (body.confirmation !== `LÖSCHEN ${rows.length}`)
      return this.error(422, 'confirmation_invalid');
    for (const r of rows) this.items.delete(r.id);
    const kinds = body.kinds as string[];
    return {
      status: 200,
      json: {
        deleted: kinds.map((kind) => ({ kind, count: rows.filter((r) => r.kind === kind).length })),
        total: rows.length,
      },
    };
  }
  /** Direct seeding without going through the API (no opt-in or secret checks). */
  seed(kind: string, data: Json, scope = '', key = '', clientRef = '') {
    const rec: Rec = {
      id: hex(++this.seq + 1000),
      kind,
      scope,
      key,
      client_ref: clientRef,
      version: 1,
      created_at: iso((this.clock += 1000)),
      updated_at: iso(this.clock),
      data,
      seq: this.seq,
    };
    this.items.set(rec.id, rec);
    return rec;
  }
}
