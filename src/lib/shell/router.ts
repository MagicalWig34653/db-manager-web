// SPDX-License-Identifier: AGPL-3.0-only
// Hash router. Routes carry only object names and tab ids; never credentials, tokens or SQL.
export type Route =
  | { kind: 'home' }
  | { kind: 'server'; tab: string }
  | { kind: 'database'; database: string; tab: string }
  | { kind: 'table'; database: string; schema?: string; table: string; tab: string };

export const defaultTabs = { server: 'uebersicht', database: 'sql', table: 'daten' } as const;
const tabPattern = /^[a-z][a-z0-9-]{0,31}$/;
const reserved = new Set(['tabelle', 'schema']);
const maxName = 255;

function decode(segment: string): string | null {
  try {
    const value = decodeURIComponent(segment);
    // eslint-disable-next-line no-control-regex
    return value.length > 0 && value.length <= maxName && !/[\u0000-\u001f\u007f]/.test(value)
      ? value
      : null;
  } catch {
    return null;
  }
}
function tab(segment: string | undefined, fallback: string): string | null {
  if (segment === undefined) return fallback;
  return tabPattern.test(segment) && !reserved.has(segment) ? segment : null;
}

export function parseHash(hash: string): Route {
  const home: Route = { kind: 'home' };
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '' || raw === '/') return home;
  if (!raw.startsWith('/')) return home;
  const parts = raw.slice(1).split('/');
  if (parts[parts.length - 1] === '') parts.pop();
  const [head, ...rest] = parts;
  if (head === 'server' && rest.length <= 1) {
    const value = tab(rest[0], defaultTabs.server);
    return value ? { kind: 'server', tab: value } : home;
  }
  if (head !== 'db' || rest.length === 0) return home;
  const database = decode(rest[0]);
  if (!database) return home;
  let cursor = 1;
  let schema: string | undefined;
  if (rest[cursor] === 'schema') {
    const value = rest[cursor + 1] === undefined ? null : decode(rest[cursor + 1]);
    if (!value) return home;
    schema = value;
    cursor += 2;
    if (rest[cursor] !== 'tabelle') return home;
  }
  if (rest[cursor] === 'tabelle') {
    const table = rest[cursor + 1] === undefined ? null : decode(rest[cursor + 1]);
    const value = tab(rest[cursor + 2], defaultTabs.table);
    if (!table || !value || rest.length > cursor + 3) return home;
    return { kind: 'table', database, ...(schema ? { schema } : {}), table, tab: value };
  }
  const value = tab(rest[cursor], defaultTabs.database);
  if (!value || rest.length > cursor + 1) return home;
  return { kind: 'database', database, tab: value };
}

export function formatRoute(route: Route): string {
  const enc = encodeURIComponent;
  switch (route.kind) {
    case 'home':
      return '#/';
    case 'server':
      return `#/server/${route.tab}`;
    case 'database':
      return `#/db/${enc(route.database)}/${route.tab}`;
    case 'table':
      return `#/db/${enc(route.database)}${route.schema ? `/schema/${enc(route.schema)}` : ''}/tabelle/${enc(route.table)}/${route.tab}`;
  }
}

export function sameRoute(a: Route, b: Route): boolean {
  return formatRoute(a) === formatRoute(b);
}
