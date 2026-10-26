import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setLocale } from '$lib/i18n';
import {
  initializePreferences,
  preferences,
  readPreferences,
  storageKey,
  updatePreferences,
} from './preferences.svelte';
import SettingsPanel from './SettingsPanel.svelte';
import ShortcutHelp from './ShortcutHelp.svelte';

let dark = false;
let onChange: (() => void) | undefined;
beforeEach(() => {
  dark = false;
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return dark;
    },
    addEventListener: (_: string, listener: () => void) => {
      onChange = listener;
    },
    removeEventListener: vi.fn(),
  }));
  Object.assign(preferences, {
    theme: 'system',
    locale: 'de',
    persist: false,
    storageFailed: false,
  });
  window.localStorage.clear();
  document.head.innerHTML = '<meta name="theme-color" content="#f7f9fc">';
});
afterEach(() => {
  setLocale('de');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('never stores without opt-in, saves only presentation preferences, and deletes on reset', () => {
  const dispose = initializePreferences();
  updatePreferences({ theme: 'dark', locale: 'en' });
  expect(window.localStorage.length).toBe(0);
  updatePreferences({ persist: true });
  expect(JSON.parse(window.localStorage.getItem(storageKey)!)).toEqual({
    version: 1,
    persist: true,
    theme: 'dark',
    locale: 'en',
  });
  updatePreferences({ persist: false });
  expect(window.localStorage.getItem(storageKey)).toBeNull();
  dispose();
});
it('applies saved preferences before mount and follows system changes only in system mode', () => {
  window.localStorage.setItem(
    storageKey,
    JSON.stringify({ version: 1, persist: true, theme: 'dark', locale: 'en' }),
  );
  const dispose = initializePreferences();
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(document.documentElement.lang).toBe('en');
  expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#111827');
  dark = false;
  onChange?.();
  expect(document.documentElement.dataset.theme).toBe('dark');
  updatePreferences({ theme: 'system' });
  expect(document.documentElement.dataset.theme).toBe('light');
  dark = true;
  onChange?.();
  expect(document.documentElement.dataset.theme).toBe('dark');
  dispose();
});
it('rejects malformed, unsupported and unconsented stored preferences', () => {
  for (const text of [
    '{',
    'null',
    '[]',
    '{"theme":"dark"}',
    '{"version":1,"persist":false,"theme":"dark","locale":"en"}',
    '{"version":1,"persist":true,"theme":"evil","locale":"en"}',
    '{"version":1,"persist":true,"theme":"light","locale":"fr"}',
  ])
    expect(readPreferences({ getItem: () => text })).toBeNull();
  expect(
    readPreferences({
      getItem: () => {
        throw new Error('denied');
      },
    }),
  ).toBeNull();
});
it('remains usable when even accessing localStorage throws', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new Error('denied');
  });
  const dispose = initializePreferences();
  expect(() => updatePreferences({ theme: 'dark', persist: true })).not.toThrow();
  expect(preferences.storageFailed).toBe(true);
  expect(document.documentElement.dataset.theme).toBe('dark');
  dispose();
});
it('switches existing rendered labels and resets the optional preferences', async () => {
  initializePreferences()();
  render(SettingsPanel);
  await fireEvent.change(screen.getByLabelText('Sprache'), { target: { value: 'en' } });
  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeVisible();
  expect(screen.getByLabelText('Language')).toHaveValue('en');
  await fireEvent.click(screen.getByLabelText('Save theme and language on this device (optional)'));
  expect(window.localStorage.getItem(storageKey)).not.toBeNull();
  await fireEvent.click(
    screen.getByRole('button', { name: 'Reset settings and delete local preferences' }),
  );
  expect(await screen.findByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  expect(window.localStorage.getItem(storageKey)).toBeNull();
});
it('renders the supplied shortcut registry instead of maintaining a separate binding list', async () => {
  render(ShortcutHelp, {
    shortcuts: [
      {
        id: 'synthetic',
        key: 'Z',
        mod: true,
        titleKey: 'settings.focusEditor',
        scopeKey: 'settings.scopeGlobal',
        run: vi.fn(),
      },
    ],
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Tastaturkürzel' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('⌘ / Ctrl + Z');
  expect(screen.getByRole('dialog')).toHaveTextContent('SQL-Editor öffnen und fokussieren');
  expect(screen.getByRole('dialog')).not.toHaveTextContent('Enter');
});
