// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { formatRoute, parseHash, type Route } from './router';

it('parses home, server, database and table deep links with defaults', () => {
  expect(parseHash('')).toEqual({ kind: 'home' });
  expect(parseHash('#/')).toEqual({ kind: 'home' });
  expect(parseHash('#/server')).toEqual({ kind: 'server', tab: 'uebersicht' });
  expect(parseHash('#/db/shop')).toEqual({ kind: 'database', database: 'shop', tab: 'sql' });
  expect(parseHash('#/db/shop/struktur')).toEqual({
    kind: 'database',
    database: 'shop',
    tab: 'struktur',
  });
  expect(parseHash('#/db/shop/tabelle/orders')).toEqual({
    kind: 'table',
    database: 'shop',
    table: 'orders',
    tab: 'daten',
  });
  expect(parseHash('#/db/shop/schema/public/tabelle/orders/struktur')).toEqual({
    kind: 'table',
    database: 'shop',
    schema: 'public',
    table: 'orders',
    tab: 'struktur',
  });
});

it('round-trips names that need escaping', () => {
  const routes: Route[] = [
    { kind: 'database', database: 'a/b c', tab: 'sql' },
    { kind: 'table', database: 'ü?#', schema: 's%1', table: 'x y/z', tab: 'daten' },
  ];
  for (const route of routes) expect(parseHash(formatRoute(route))).toEqual(route);
});

it('falls back to home for invalid or unexpected hashes', () => {
  for (const hash of [
    'foo',
    '#foo',
    '#/unknown',
    '#/db',
    '#/db/',
    '#/db/%E0%A4%A/sql',
    '#/db/x/tabelle',
    '#/db/x/tabelle/t/daten/extra',
    '#/db/x/schema/s/orders',
    '#/db/x/UPPER',
    '#/db/x/sql/more',
    '#/server/a/b',
    '#/db/x%00y',
  ])
    expect(parseHash(hash), hash).toEqual({ kind: 'home' });
});

it('never puts anything but names and tab ids into the hash', () => {
  const hash = formatRoute({ kind: 'table', database: 'd', table: 't', tab: 'daten' });
  expect(hash).toBe('#/db/d/tabelle/t/daten');
});
