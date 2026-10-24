// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest';
import { dispatch, matches } from './shortcuts';

const key = (init: KeyboardEventInit) =>
  new KeyboardEvent('keydown', { cancelable: true, ...init });

it('matches key and modifier exactly', () => {
  expect(matches(key({ key: 'k', ctrlKey: true }), { key: 'k', mod: true })).toBe(true);
  expect(matches(key({ key: 'k', metaKey: true }), { key: 'k', mod: true })).toBe(true);
  expect(matches(key({ key: 'k' }), { key: 'k', mod: true })).toBe(false);
  expect(matches(key({ key: 'Escape', ctrlKey: true }), { key: 'Escape' })).toBe(false);
});

it('runs only the first enabled binding and prevents default', () => {
  const first = vi.fn();
  const second = vi.fn();
  const event = key({ key: 'Escape' });
  const id = dispatch(event, [
    { id: 'a', key: 'Escape', when: () => false, run: first },
    { id: 'b', key: 'Escape', run: second },
  ]);
  expect(id).toBe('b');
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
  expect(event.defaultPrevented).toBe(true);
  expect(dispatch(key({ key: 'x' }), [])).toBeUndefined();
});
