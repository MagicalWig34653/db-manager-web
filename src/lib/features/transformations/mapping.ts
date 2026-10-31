// SPDX-License-Identifier: AGPL-3.0-only
// The column -> transformation assignment (W-P22) and its stored form. Only the assignment is persisted (column name,
// transformation id, options); a cell value never is. Everything read back from storage is rebuilt field by field from
// an allowlist, so a manipulated or old document can never inject an unknown transformation or an oversized option.
import {
  defaultOptions,
  isDisplayId,
  isInputId,
  sanitizeOptions,
  type DisplayId,
  type InputId,
  type Options,
} from './transforms';

export interface Assignment<Id extends string> {
  id: Id;
  options: Options;
}
export interface ColumnMapping {
  column: string;
  display?: Assignment<DisplayId>;
  input?: Assignment<InputId>;
}
export const MAPPING_LIMITS = {
  columns: 200,
  columnName: 128,
  localBytes: 256 * 1024,
  localTables: 100,
} as const;

const own = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function readAssignment<Id extends string>(
  value: unknown,
  valid: (id: unknown) => id is Id,
): Assignment<Id> | undefined {
  if (!own(value) || !valid(value.id)) return undefined;
  return { id: value.id, options: sanitizeOptions(value.id, value.options) };
}

/** Rebuilds a mapping from stored data; anything unexpected is dropped. */
export function parseMapping(data: unknown): ColumnMapping[] {
  if (!own(data) || data.v !== 1 || !Array.isArray(data.columns)) return [];
  const seen = new Set<string>();
  const list: ColumnMapping[] = [];
  for (const entry of data.columns.slice(0, MAPPING_LIMITS.columns)) {
    if (!own(entry) || typeof entry.name !== 'string') continue;
    const column = entry.name;
    if (!column || column.length > MAPPING_LIMITS.columnName || seen.has(column)) continue;
    const display = readAssignment(entry.display, isDisplayId);
    const input = readAssignment(entry.input, isInputId);
    if (!display && !input) continue;
    seen.add(column);
    list.push({ column, ...(display ? { display } : {}), ...(input ? { input } : {}) });
  }
  return list;
}

const nonDefault = (id: string, options: Options): Options | undefined => {
  const base = defaultOptions(id);
  const changed = Object.entries(options).filter(([key, value]) => base[key] !== value);
  return changed.length ? Object.fromEntries(changed) : undefined;
};
const writeAssignment = (assignment: Assignment<string>) => {
  const options = nonDefault(assignment.id, assignment.options);
  return { id: assignment.id, ...(options ? { options } : {}) };
};

/** Stored form: at most 5 levels, no null, column names only as values (a column called "password" is harmless). */
export function toDocument(list: ColumnMapping[]): Record<string, unknown> {
  return {
    v: 1,
    columns: list.slice(0, MAPPING_LIMITS.columns).map((m) => ({
      name: m.column,
      ...(m.display ? { display: writeAssignment(m.display) } : {}),
      ...(m.input ? { input: writeAssignment(m.input) } : {}),
    })),
  };
}

/** Replaces the entry of a column; an entry without any assignment removes it. */
export function withColumn(list: ColumnMapping[], next: ColumnMapping): ColumnMapping[] {
  const rest = list.filter((m) => m.column !== next.column);
  return next.display || next.input ? [...rest, next] : rest;
}

/** Opaque, fixed-length document key of a table (the layouts key allows 200 characters; names are not put in it). */
export async function documentKey(
  database: string,
  schema: string | undefined,
  table: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify([database, schema ?? '', table])),
  );
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `transformations.${hex.slice(0, 40)}`;
}

// ----- browser storage, only after an explicit opt-in -----

export const LOCAL_KEY = 'db-manager.transformations.v1';
type LocalDoc = { v: 1; tables: Record<string, Record<string, unknown>> };

function readLocal(): LocalDoc | null {
  try {
    const text = localStorage.getItem(LOCAL_KEY);
    if (text === null) return null;
    if (text.length > MAPPING_LIMITS.localBytes) return { v: 1, tables: {} };
    const parsed: unknown = JSON.parse(text);
    if (!own(parsed) || parsed.v !== 1 || !own(parsed.tables)) return { v: 1, tables: {} };
    const tables: LocalDoc['tables'] = Object.create(null);
    for (const [key, value] of Object.entries(parsed.tables).slice(0, MAPPING_LIMITS.localTables))
      if (own(value)) tables[key] = value;
    return { v: 1, tables };
  } catch {
    return null;
  }
}

export const localOptedIn = () => readLocal() !== null;
export function localEnable(): boolean {
  try {
    if (localStorage.getItem(LOCAL_KEY) === null)
      localStorage.setItem(LOCAL_KEY, JSON.stringify({ v: 1, tables: {} }));
    return true;
  } catch {
    return false;
  }
}
/** Switching the opt-in off deletes everything stored for it. */
export function localDisable(): void {
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    // storage unavailable: nothing was stored by us either
  }
}
export function localRead(key: string): ColumnMapping[] | null {
  const doc = readLocal();
  return doc && Object.hasOwn(doc.tables, key) ? parseMapping(doc.tables[key]) : doc ? [] : null;
}
export function localWrite(key: string, list: ColumnMapping[]): boolean {
  const doc = readLocal();
  if (!doc) return false;
  if (list.length === 0) delete doc.tables[key];
  else if (
    Object.keys(doc.tables).length >= MAPPING_LIMITS.localTables &&
    !Object.hasOwn(doc.tables, key)
  )
    return false;
  else doc.tables[key] = toDocument(list);
  const text = JSON.stringify({ v: 1, tables: { ...doc.tables } });
  if (text.length > MAPPING_LIMITS.localBytes) return false;
  try {
    localStorage.setItem(LOCAL_KEY, text);
    return true;
  } catch {
    return false;
  }
}
