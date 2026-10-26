// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic fixtures; no live observations.
import { actions, type Schemas, type Action } from './model';
export const hash = 'a'.repeat(64);
export const ref = { name: 'synthetic', host: '%' };
export const connection: Schemas['Connection'] = {
  driver: 'mysql',
  database: 'synthetic',
  host: 'fixture.invalid',
  port: 3306,
  username: 'synthetic',
  password: '',
  tls_mode: 'verify-full',
};
export function capabilities(): Schemas['AccountsCapabilities'] {
  const open = Object.fromEntries(
    ['list', 'inspect', ...actions].map((key) => [key, { support: 'supported' }]),
  );
  const closed = Object.fromEntries(
    ['list', 'inspect', ...actions].map((key) => [
      key,
      { support: 'unsupported', reason: 'SQLite hat keine Konten.' },
    ]),
  );
  return {
    contract_version: '0.15.0',
    drivers: { sqlite: closed, mysql: open, postgres: open },
  } as Schemas['AccountsCapabilities'];
}
export function info(): Schemas['AccountInfo'] {
  return {
    account: { ...ref },
    current: true,
    login: true,
    locked: false,
    auth_plugin: 'synthetic_plugin',
    ssl_type: 'ANY',
    limits: { max_user_connections: 7 },
    attributes: ['CREATEROLE'],
  };
}
export function details(): Schemas['AccountDetails'] {
  return {
    info: info(),
    grants: [
      { scope: 'global', privilege: 'CREATE USER', grant_option: false },
      { scope: 'database', database: 'synthetic', privilege: 'CONNECT', grant_option: false },
      {
        scope: 'table',
        database: 'synthetic',
        schema: 'public',
        object: 'orders',
        privilege: 'SELECT',
        grant_option: true,
      },
      {
        scope: 'column',
        database: 'synthetic',
        schema: 'public',
        object: 'orders',
        column: 'note',
        privilege: 'UPDATE',
        grant_option: false,
      },
      {
        scope: 'routine',
        database: 'synthetic',
        schema: 'public',
        object: 'f',
        routine_kind: 'function',
        routine_id: '123',
        privilege: 'EXECUTE',
        grant_option: false,
      },
    ],
    roles: [{ name: 'synthetic_role', host: '%' }],
    notes: ['Nur synthetische direkte Rechte.'],
  };
}
export function plan(
  action: Action = 'password',
  over: Partial<Schemas['AccountPlan']> = {},
): Schemas['AccountPlan'] {
  return {
    driver: 'mysql',
    statements: ['ALTER USER synthetic IDENTIFIED BY <protected-secret>'],
    warnings: ['Synthetische Warnung'],
    affected_objects: ['synthetic@%'],
    plan_sha256: hash,
    action,
    confirmation: { action, target_name: '9:synthetic@%', acknowledge_self: true },
    destructive: true,
    self: true,
    requires_secret: ['create', 'copy', 'password'].includes(action),
    ...over,
  };
}
export function result(
  outcome: Schemas['AccountResult']['outcome'] = 'completed',
): Schemas['AccountResult'] {
  return { outcome, message: 'Synthetisch', statements_executed: 1, atomic: false };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
