// SPDX-License-Identifier: AGPL-3.0-only
import { getContext, setContext } from 'svelte';
import type { Session } from './session.svelte';
import type { SqlRunner } from './sql.svelte';

export interface ShellContext {
  session: Session;
  sql: SqlRunner;
}
const key = Symbol('db-manager-shell');
export const setShellContext = (value: ShellContext) => setContext(key, value);
export const getShellContext = () => getContext<ShellContext>(key);
