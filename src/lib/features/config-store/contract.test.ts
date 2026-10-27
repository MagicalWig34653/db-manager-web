// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as validators from '$lib/contract/v24/validators.js';
import { AppearanceSync } from './appearance.svelte';
import { WriteBuffer, BUFFER_KEY } from './buffer.svelte';
import { ConfigClient, ConfigError } from './client';
import { ConfigStore } from './store.svelte';
import { FakeConfigServer } from './testing';

describe('API 0.24 provenance and fixtures', () => {
  it('pins exact source bytes and the integrated backend-main origin', () => {
    const provenance = JSON.parse(readFileSync('src/lib/contract/v24/provenance.json', 'utf8'));
    const sha = createHash('sha256')
      .update(readFileSync('src/lib/contract/v24/api-v0.24.0.json'))
      .digest('hex');
    expect(sha).toBe('e2f2e057f341e52d23b9ec098c2a1b04e5f90dd18f5e560cbfaad844f463da7a');
    expect(provenance.sha256).toBe(sha);
    expect(provenance.source_commit).toBe('a40b20d7ffc0abf0fdbb01312d5832622c6271c8');
  });
  for (const file of readdirSync('src/lib/features/config-store/fixtures').filter((f) =>
    f.endsWith('.json'),
  )) {
    it(file, () => {
      const schema = file.split('.')[0] as keyof typeof validators;
      const fixture = JSON.parse(
        readFileSync(`src/lib/features/config-store/fixtures/${file}`, 'utf8'),
      );
      expect(validators[schema](fixture)).toBe(!file.includes('.invalid.'));
    });
  }
  it('validates every answer of the in-memory test server against the contract', async () => {
    const fake = new FakeConfigServer();
    const client = new ConfigClient(fake.fetch);
    const caps = await client.capabilities(fake.token);
    expect(validators.ConfigCapabilities(caps)).toBe(true);
    fake.seed('bookmarks', { name: 'n', sql: 'SELECT 1' }, 's');
    expect(validators.ConfigList(await client.list(fake.token, 'bookmarks', { scope: 's' }))).toBe(
      true,
    );
    expect(validators.ConfigStatus(await client.status(fake.token))).toBe(true);
    const plan = await client.clearPlan(fake.token, { kinds: ['bookmarks'] });
    expect(plan.confirmation).toBe('LÖSCHEN 1');
  });
});

describe('ConfigClient', () => {
  let fake: FakeConfigServer;
  beforeEach(() => {
    fake = new FakeConfigServer();
  });
  it('sends If-Match on every update and delete, so the server never has to answer 428', async () => {
    const client = new ConfigClient(fake.fetch);
    const { item } = await client.create(fake.token, 'bookmarks', {
      scope: 's',
      data: { name: 'n', sql: 'SELECT 1' },
    });
    await client.update(fake.token, 'bookmarks', item.id, item.version, {
      name: 'm',
      sql: 'SELECT 1',
    });
    await client.remove(fake.token, 'bookmarks', item.id, 2);
    expect(
      fake.calls.filter((c) => c.method !== 'GET' && c.method !== 'POST').map((c) => c.ifMatch),
    ).toEqual(['"1"', '"2"']);
  });
  it('raw 428 and 412 map to stable codes', async () => {
    const item = fake.seed('bookmarks', { name: 'n', sql: 'SELECT 1' }, 's');
    const raw = await fake.fetch(`/api/v24/config/bookmarks/${item.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${fake.token}` },
    });
    expect(raw.status).toBe(428);
    const client = new ConfigClient(fake.fetch);
    await expect(client.remove(fake.token, 'bookmarks', item.id, 9)).rejects.toMatchObject({
      code: 'version_conflict',
      status: 412,
    });
  });
  it('maps 503 to state_unavailable with Retry-After and a lost write answer to outcome_unknown', async () => {
    fake.down = true;
    const client = new ConfigClient(fake.fetch);
    await expect(client.list(fake.token, 'history')).rejects.toMatchObject({
      code: 'state_unavailable',
      retryAfter: 5,
    });
    fake.down = false;
    fake.loseNextWriteAnswer = true;
    await expect(
      client.create(fake.token, 'bookmarks', { scope: 's', data: { name: 'n', sql: 'SELECT 1' } }),
    ).rejects.toMatchObject({ code: 'outcome_unknown' });
    fake.failNetwork = true;
    await expect(client.list(fake.token, 'history')).rejects.toMatchObject({
      code: 'network_error',
    });
  });
  it('never shows a server message and rejects invalid or oversized answers', async () => {
    const bad = (body: string, status = 200, type = 'application/json') =>
      new ConfigClient(
        async () => new Response(body, { status, headers: { 'Content-Type': type } }),
      );
    const error = await bad('{"error":{"code":"secret_rejected","message":"hunter2 leaked"}}', 422)
      .create('t', 'history', { data: { sql: 'x' } })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.message).not.toContain('hunter2');
    await expect(bad('<html>', 200, 'text/html').capabilities('t')).rejects.toMatchObject({
      code: 'invalid_response',
    });
    await expect(bad('{"error":"x"}', 500).capabilities('t')).rejects.toMatchObject({
      code: 'rejected',
    });
    await expect(bad('{"items":[],"next_cursor":5}').list('t', 'history')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
  it('validates requests before sending (unknown fields, bad scope)', async () => {
    const client = new ConfigClient(fake.fetch);
    await expect(
      client.create(fake.token, 'history', { scope: 'bad scope!', data: { sql: 'x' } }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fake.calls).toHaveLength(0);
  });
});

describe('write buffer', () => {
  beforeEach(() => localStorage.clear());
  it('persists, ignores malformed stored entries and survives unavailable storage', () => {
    const buffer = new WriteBuffer(() => localStorage);
    buffer.add({
      kind: 'bookmarks',
      scope: 'a',
      client_ref: 'r1',
      time: '2026-10-01T00:00:00.000Z',
      data: { name: 'n', sql: 'SELECT 1' },
    });
    expect(new WriteBuffer(() => localStorage).entries).toHaveLength(1);
    localStorage.setItem(
      BUFFER_KEY,
      JSON.stringify({
        version: 1,
        entries: [
          { kind: 'x' },
          { kind: 'history', scope: 'bad scope', client_ref: 'r', time: 't', data: { sql: 'x' } },
        ],
      }),
    );
    expect(new WriteBuffer(() => localStorage).entries).toEqual([]);
    const broken = new WriteBuffer(() => {
      throw new Error('denied');
    });
    expect(broken.storageFailed).toBe(true);
    expect(
      broken.add({ kind: 'history', scope: '', client_ref: 'r2', time: 't', data: { sql: 'x' } }),
    ).toBe(true);
    expect(broken.entries).toHaveLength(1); // memory only
  });
});

describe('appearance sync (theme and language only)', () => {
  it('loads the server values, sends allowlisted changes after a pause and lets the server win on a conflict', async () => {
    vi.useFakeTimers();
    try {
      const fake = new FakeConfigServer();
      const store = new ConfigStore(fake.token, {
        client: new ConfigClient(fake.fetch),
        buffer: new WriteBuffer(() => localStorage),
      });
      await store.ensureReady();
      fake.seed('settings', { theme: 'dark', locale: 'en' }, '', 'appearance');
      const applied: unknown[] = [];
      const sync = new AppearanceSync(store, (v) => applied.push(v), 100);
      await sync.load();
      expect(applied).toEqual([{ theme: 'dark', locale: 'en' }]);
      sync.push('dark', 'en'); // unchanged: no request
      await vi.advanceTimersByTimeAsync(200);
      expect(fake.writes()).toHaveLength(0);
      sync.push('light', 'en');
      sync.push('light', 'de');
      await vi.advanceTimersByTimeAsync(200);
      const puts = fake.writes();
      expect(puts).toHaveLength(1);
      expect(puts[0].body).toEqual({ data: { theme: 'light', locale: 'de' } });
      // Changed on another device in between.
      const rec = [...fake.items.values()].find((i) => i.key === 'appearance')!;
      rec.version = 9;
      rec.data = { theme: 'system', locale: 'de' };
      sync.push('dark', 'de');
      await vi.advanceTimersByTimeAsync(200);
      expect(applied.at(-1)).toEqual({ theme: 'system', locale: 'de' });
      expect(sync.notice).toContain('anderswo geändert');
      expect(rec.data).toEqual({ theme: 'system', locale: 'de' });
    } finally {
      vi.useRealTimers();
    }
  });
});
