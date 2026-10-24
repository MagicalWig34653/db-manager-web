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
