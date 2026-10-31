// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { emptyConnection } from '$lib/workbench';
import ResultTable from '$lib/components/ResultTable.svelte';
import { WriteBuffer } from '../config-store/buffer.svelte';
import { ConfigClient } from '../config-store/client';
import { ConfigStore } from '../config-store/store.svelte';
import { FakeConfigServer } from '../config-store/testing';
import { documentKey, LOCAL_KEY, parseMapping, toDocument } from './mapping';
import { TransformState } from './state.svelte';

let fake: FakeConfigServer;
beforeEach(() => {
  localStorage.clear();
  fake = new FakeConfigServer();
});
const store = () =>
  new ConfigStore(fake.token, {
    client: new ConfigClient(fake.fetch),
    buffer: new WriteBuffer(() => localStorage),
  });
const connection = { ...emptyConnection(), database: 'synthetic.db' };
const make = (s = store()) => new TransformState(s, connection, { name: 't' });

describe('stored form', () => {
  it('round-trips only the assignment and drops everything unexpected', () => {
    const doc = toDocument([
      {
        column: 'c',
        display: { id: 'truncate', options: { start: 0, length: 10, ellipsis: '…' } },
      },
    ]);
    expect(doc).toEqual({
      v: 1,
      columns: [{ name: 'c', display: { id: 'truncate', options: { length: 10 } } }],
    });
    expect(parseMapping(doc)[0].display?.options).toEqual({ start: 0, length: 10, ellipsis: '…' });
    const hostile = {
      v: 1,
      columns: [
        { name: 'x', display: { id: 'external_program', options: { cmd: 'rm -rf /' } } },
        { name: 'x', display: { id: 'json' }, input: { id: 'nope' } },
        { name: 'x', display: { id: 'json' } },
        { name: 5, display: { id: 'json' } },
        { name: 'y', display: { id: 'hex', options: { maxBytes: 1e12, evil: 1 } } },
      ],
    };
    const list = parseMapping(hostile);
    expect(list.map((m) => m.column)).toEqual(['x', 'y']);
    expect(list[0].display?.id).toBe('json');
    expect(list[1].display?.options).toEqual({ maxBytes: 65536 });
    expect(parseMapping(null)).toEqual([]);
    expect(parseMapping({ v: 2, columns: [] })).toEqual([]);
  });
  it('keeps document keys opaque and fixed-length', async () => {
    const key = await documentKey('secret_db', 'public', 'password_table');
    expect(key).toMatch(/^transformations\.[0-9a-f]{40}$/);
    expect(key).not.toContain('password');
  });
});

describe('persistence', () => {
  it('server mode: saves a layouts document with version checks, reloads it, never stores cell values', async () => {
    const a = make();
    await a.load();
    expect(a.storage).toBe('server');
    expect(await a.set({ column: 'c', display: { id: 'json', options: {} } })).toBe(true);
    const saved = [...fake.items.values()].filter((i) => i.kind === 'layouts');
    expect(saved).toHaveLength(1);
    expect(JSON.stringify(saved[0].data)).not.toMatch(/value/);
    const b = make();
    await b.load();
    expect(b.mappingFor('c')?.display?.id).toBe('json');
    await b.set({ column: 'c', display: { id: 'hex', options: { maxBytes: 64 } } });
    expect(fake.calls.filter((c) => c.method === 'PUT' && c.ifMatch).length).toBe(1);
  });
  it('merges per column on a version conflict instead of overwriting', async () => {
    const a = make();
    const b = make();
    await a.load();
    await b.load();
    await a.set({ column: 'one', display: { id: 'json', options: {} } });
    await b.set({ column: 'two', display: { id: 'xml', options: {} } });
    const c = make();
    await c.load();
    expect(c.list.map((m) => m.column).sort()).toEqual(['one', 'two']);
  });
  it('local mode: nothing in the browser storage without opt-in', async () => {
    fake.state = 'not_configured';
    const s = make();
    await s.load();
    expect(s.storage).toBe('session');
    await s.set({ column: 'c', display: { id: 'json', options: {} } });
    expect(localStorage.getItem(LOCAL_KEY)).toBeNull();
    expect(fake.calls.filter((c) => c.path.includes('/config/layouts'))).toEqual([]);
    expect(Object.keys(localStorage)).toEqual([]);
  });
  it('local mode: opt-in stores the assignment locally, opt-out deletes it', async () => {
    fake.state = 'not_configured';
    const s = make();
    await s.load();
    await s.setBrowserStorage(true);
    await s.set({ column: 'c', display: { id: 'json', options: {} } });
    expect(localStorage.getItem(LOCAL_KEY)).toContain('"json"');
    const again = make();
    await again.load();
    expect(again.mappingFor('c')?.display?.id).toBe('json');
    await again.setBrowserStorage(false);
    expect(localStorage.getItem(LOCAL_KEY)).toBeNull();
  });
  it('a manipulated local document cannot inject anything', async () => {
    fake.state = 'not_configured';
    const s = make();
    await s.load();
    await s.setBrowserStorage(true);
    const key = await documentKey(connection.database, undefined, 't');
    localStorage.setItem(
      LOCAL_KEY,
      JSON.stringify({
        v: 1,
        tables: {
          [key]: { v: 1, columns: [{ name: 'c', display: { id: 'external', options: {} } }] },
          __proto__: { x: 1 },
        },
      }),
    );
    const t = make();
    await t.load();
    expect(t.list).toEqual([]);
    localStorage.setItem(LOCAL_KEY, '{not json');
    const u = make();
    await u.load();
    expect(u.storage).toBe('session');
  });
});

describe('result table with transformations', () => {
  const result = {
    columns: [
      { name: 'url', type: 'TEXT' },
      { name: 'doc', type: 'TEXT' },
    ],
    rows: [
      [
        { kind: 'text', value: 'https://example.com/a' },
        { kind: 'text', value: '{"a":1}' },
      ],
      [
        { kind: 'text', value: 'javascript:alert(1)' },
        { kind: 'text', value: '<img src=x onerror=alert(1)>' },
      ],
    ],
    truncated: false,
  };
  it('renders links with noopener, hostile values as text, and returns to the raw value', async () => {
    const s = make();
    await s.load();
    await s.set({ column: 'url', display: { id: 'link', options: {} } });
    await s.set({ column: 'doc', display: { id: 'json', options: {} } });
    const { container } = render(ResultTable, { result, transforms: s });
    const link = screen.getByRole('link', { name: 'https://example.com/a' });
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelector('img, svg:not([class*="lucide"]), script')).toBeNull();
    expect(screen.getByText('javascript:alert(1)')).toBeVisible();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    await fireEvent.click(screen.getByRole('button', { name: /text: .*\{/ }));
    expect(screen.getByRole('button', { name: 'Transformiert' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Rohansicht' }));
    await waitFor(() =>
      expect(document.querySelector('pre.full-cell')?.textContent).toBe('{"a":1}'),
    );
  });
  it('opens the assignment dialog with a preview and stores the choice', async () => {
    const s = make();
    await s.load();
    render(ResultTable, { result, transforms: s });
    await fireEvent.click(screen.getByRole('button', { name: 'Anzeige für Spalte doc festlegen' }));
    await fireEvent.change(screen.getByLabelText('Anzeige-Transformation'), {
      target: { value: 'json' },
    });
    expect(screen.getByText('Vorschau')).toBeVisible();
    await fireEvent.click(screen.getByRole('button', { name: 'Zuordnung übernehmen' }));
    await waitFor(() => expect(s.mappingFor('doc')?.display?.id).toBe('json'));
  });
});
