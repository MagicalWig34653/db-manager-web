// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { emptyConnection } from '$lib/workbench';
import {
  libraryFor,
  MAX_BYTES,
  MAX_ENTRIES,
  PREFIX,
  recordQuery,
  safeSql,
  SqlLibrary,
} from './storage.svelte';

beforeEach(() => {
  localStorage.clear();
});
const entry = (sql = 'SELECT 1', name = 'Example') => ({
  sql,
  name,
  time: '2026-10-25T10:00:00.000Z',
});

describe('local SQL library', () => {
  it('does not write history before opt-in, persists after opt-in and purges on disabling', () => {
    const library = new SqlLibrary('test');
    expect(library.record('SELECT 1')).toBe(false);
    expect(localStorage.length).toBe(0);
    library.setEnabled(true);
    library.record('SELECT 2');
    expect(new SqlLibrary('test').history[0].sql).toBe('SELECT 2');
    library.setEnabled(false);
    expect(library.history).toEqual([]);
    expect(localStorage.getItem('test')).toBeNull();
    expect(new SqlLibrary('test').enabled).toBe(false);
  });
  it('keeps bookmarks when history is disabled and supports individual and full deletion', () => {
    const library = new SqlLibrary('test');
    library.bookmark('One', 'SELECT 1');
    library.bookmark('Two', 'SELECT 2');
    library.setEnabled(true);
    library.record('SELECT 3');
    library.record('SELECT 4');
    library.remove('history', library.history[0].id);
    expect(new SqlLibrary('test').history.map((e) => e.sql)).toEqual(['SELECT 3']);
    library.setEnabled(false);
    expect(new SqlLibrary('test').bookmarks).toHaveLength(2);
    library.remove('bookmarks', library.bookmarks[0].id);
    expect(new SqlLibrary('test').bookmarks[0].name).toBe('One');
    library.remove('bookmarks');
    expect(localStorage.getItem('test')).toBeNull();
  });
  it('bounds history by count and serialized bytes, rejecting oversized SQL', () => {
    const library = new SqlLibrary('test');
    library.setEnabled(true);
    for (let i = 0; i < 205; i++) library.record(`SELECT ${i}`);
    expect(library.history).toHaveLength(MAX_ENTRIES);
    expect(library.history[0].sql).toBe('SELECT 204');
    expect(library.history.at(-1)?.sql).toBe('SELECT 5');
    for (let i = 0; i < 20; i++) library.record('SELECT ' + '😀'.repeat(20000));
    expect(new TextEncoder().encode(localStorage.getItem('test')!).length).toBeLessThan(MAX_BYTES);
    expect(library.record('x'.repeat(100001))).toBe(false);
    library.bookmark('Keep', 'SELECT 1');
    expect(library.bookmark('Too large', 'SELECT ' + '\u0000'.repeat(50000))).toBe(false);
    expect(library.bookmarks[0].name).toBe('Keep');
  });
  it('continues in memory when reading, writing or removing storage fails', () => {
    const library = new SqlLibrary('test', () => {
      throw new Error('Denied');
    });
    expect(library.storageUnavailable).toBe(true);
    library.setEnabled(true);
    expect(library.record('SELECT 1')).toBe(true);
    expect(library.bookmark('One', 'SELECT 2')).toBe(true);
    library.setEnabled(false);
    library.remove('bookmarks');
    expect(library.history).toEqual([]);
    expect(library.bookmarks).toEqual([]);
    expect(library.storageUnavailable).toBe(true);
  });
  it('handles quota errors and corrupt payloads without blocking editing', () => {
    localStorage.setItem('test', '{bad');
    expect(new SqlLibrary('test').enabled).toBe(false);
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('Quota');
      },
      removeItem: vi.fn(),
    } as unknown as Storage;
    const library = new SqlLibrary('test', () => storage);
    library.bookmark('Example', 'SELECT 1');
    expect(library.bookmarks).toHaveLength(1);
    expect(library.storageUnavailable).toBe(true);
  });
  it('roundtrips only bookmark fields and imports atomically without enabling history', () => {
    const library = new SqlLibrary('test');
    library.bookmark('<img src=x>', "SELECT '<script>'");
    const exported = library.exportBookmarks();
    expect(exported).not.toMatch(/enabled|history|password|token|connection/);
    const target = new SqlLibrary('other');
    target.importBookmarks(exported);
    expect(target.bookmarks[0].sql).toBe("SELECT '<script>'");
    expect(target.enabled).toBe(false);
    const snapshot = target.exportBookmarks();
    for (const text of [
      '{}',
      '{bad',
      JSON.stringify({ version: 2, bookmarks: [] }),
      JSON.stringify({ version: 1, bookmarks: [entry(), { sql: 42 }] }),
      'x'.repeat(MAX_BYTES + 1),
    ]) {
      expect(() => target.importBookmarks(text)).toThrow();
      expect(target.exportBookmarks()).toBe(snapshot);
    }
  });
  it('does not serialize active credentials or common credential statements', () => {
    const library = new SqlLibrary('test');
    library.setEnabled(true);
    for (const sql of [
      "SELECT 'synthetic-password'",
      "SELECT 'synthetic-token'",
      "ALTER USER a IDENTIFIED BY 'x'",
      "SET password = 'x'",
    ]) {
      expect(library.record(sql, ['synthetic-password', 'synthetic-token'])).toBe(false);
      expect(library.bookmark('Test', sql, ['synthetic-password', 'synthetic-token'])).toBe(false);
    }
    expect(library.bookmark('synthetic-token', 'SELECT 1', ['synthetic-token'])).toBe(false);
    expect(() =>
      library.importBookmarks(
        JSON.stringify({ version: 1, bookmarks: [entry("SELECT 'synthetic-token'")] }),
        ['synthetic-token'],
      ),
    ).toThrow();
    expect(safeSql('SELECT 1')).toBe(true);
    expect(localStorage.getItem('test')).not.toMatch(/synthetic-password|synthetic-token/);
  });
  it('isolates sources and persists only opaque identifiers, not connection credentials', async () => {
    vi.stubGlobal('crypto', webcrypto);
    try {
      const first = {
        ...emptyConnection(),
        driver: 'mysql' as const,
        database: 'synthetic-db',
        host: 'synthetic-host',
        username: 'synthetic-user',
        password: 'synthetic-password',
      };
      const library = await libraryFor(first);
      library.setEnabled(true);
      recordQuery(first, 'SELECT 7', 'synthetic-token');
      await vi.waitFor(() => expect(library.history).toHaveLength(1));
      expect(await libraryFor({ ...first, password: 'changed' })).toBe(library);
      for (const change of [
        { database: 'other' },
        { host: 'other' },
        { port: 123 },
        { username: 'other' },
        { driver: 'postgresql' as const },
      ]) {
        const other = await libraryFor({ ...first, ...change });
        expect(other.history).toEqual([]);
        expect(other.enabled).toBe(false);
      }
      const stored = JSON.stringify(Object.entries(localStorage));
      expect(stored).toContain(PREFIX);
      expect(stored).not.toMatch(/synthetic-(db|host|user|password|token)/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
