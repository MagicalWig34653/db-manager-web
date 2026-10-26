import { setLocale, type Locale } from '$lib/i18n/locale.svelte';
export type Theme = 'light' | 'dark' | 'system';
export const storageKey = 'db-manager.settings.v1';
export const preferences = $state({
  theme: 'system' as Theme,
  locale: 'de' as Locale,
  persist: false,
  storageFailed: false,
});

export function readPreferences(storage: Pick<Storage, 'getItem'>) {
  try {
    const value: unknown = JSON.parse(storage.getItem(storageKey) ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const data = value as Record<string, unknown>;
    if (
      data.version !== 1 ||
      data.persist !== true ||
      !['light', 'dark', 'system'].includes(String(data.theme)) ||
      !['de', 'en'].includes(String(data.locale))
    )
      return null;
    return { theme: data.theme as Theme, locale: data.locale as Locale, persist: true };
  } catch {
    return null;
  }
}

export function applyPreferences(dark = window.matchMedia('(prefers-color-scheme: dark)').matches) {
  const theme = preferences.theme === 'system' ? (dark ? 'dark' : 'light') : preferences.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#111827' : '#f7f9fc');
  setLocale(preferences.locale);
}

export function updatePreferences(
  next: Partial<Pick<typeof preferences, 'theme' | 'locale' | 'persist'>>,
) {
  Object.assign(preferences, next);
  applyPreferences();
  preferences.storageFailed = false;
  try {
    if (preferences.persist) {
      // Only these allowlisted presentation preferences may be serialized.
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          version: 1,
          persist: true,
          theme: preferences.theme,
          locale: preferences.locale,
        }),
      );
    } else window.localStorage.removeItem(storageKey);
  } catch {
    preferences.storageFailed = true;
  }
}

export function initializePreferences(): () => void {
  try {
    const saved = readPreferences(window.localStorage);
    if (saved) Object.assign(preferences, saved);
  } catch {
    /* Storage is optional, including access to the property itself. */
  }
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  applyPreferences(media.matches);
  const change = () => applyPreferences(media.matches);
  media.addEventListener('change', change);
  return () => media.removeEventListener('change', change);
}
