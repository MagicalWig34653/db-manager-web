// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { Session } from './session.svelte';

const hooks = { onConnected: () => {}, onCatalogSettled: () => {}, onCleared: () => {} };

it('database write receiver tracks the phase and raises the unknown notice', () => {
  const session = new Session(hooks);
  const receive = session.databaseWriteReceiver(session.sessionVersion);
  receive('sending');
  expect(session.writeInFlight).toBe(true);
  receive('unknown');
  expect(session.writeInFlight).toBe(false);
  expect(session.writeNotice).toBe(true);
});
it('database write receiver ignores phases of an older session', () => {
  const session = new Session(hooks);
  const receive = session.databaseWriteReceiver(session.sessionVersion);
  receive('sending');
  session.clearSession();
  expect(session.writeNotice).toBe(true);
  session.writeNotice = false;
  receive('unknown');
  expect(session.writeInFlight).toBe(false);
  expect(session.writeNotice).toBe(false);
});

it('counts overlapping writes: the first answer does not lift the protection of the second', () => {
  const session = new Session(hooks);
  const a = session.databaseWriteReceiver(session.sessionVersion);
  const b = session.databaseWriteReceiver(session.sessionVersion);
  a('sending');
  b('sending');
  expect(session.writeCount).toBe(2);
  a('settled');
  expect(session.writeInFlight).toBe(true);
  b('unknown');
  expect(session.writeInFlight).toBe(false);
  expect(session.writeNotice).toBe(true);
  b('settled');
  expect(session.writeCount).toBe(0);
});
it('table receiver also counts end phases after the selected object changed', () => {
  const session = new Session(hooks);
  const receive = session.writeReceiver({ name: 'a', type: 'table' }, session.sessionVersion);
  receive('sending');
  expect(session.writeInFlight).toBe(true);
  session.selectedObject = { name: 'b', type: 'table' };
  receive('settled');
  expect(session.writeInFlight).toBe(false);
});
