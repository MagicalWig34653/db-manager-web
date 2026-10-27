// SPDX-License-Identifier: AGPL-3.0-only
// Theme and language in the server store (settings/appearance). Only these two allowlisted presentation values are
// sent: no secrets, no other preferences. A version conflict never overwrites: the server's state wins and is applied.
import { t } from '$lib/i18n';
import type { Item } from './client';
import type { ConfigStore } from './store.svelte';

export const APPEARANCE_KEY = 'appearance';
type Value = { theme: string; locale: string };
const themes = ['light', 'dark', 'system'];
const locales = ['de', 'en'];
const read = (item: Item | null): Value | null => {
  const { theme, locale } = item?.data ?? {};
  return typeof theme === 'string' &&
    typeof locale === 'string' &&
    themes.includes(theme) &&
    locales.includes(locale)
    ? { theme, locale }
    : null;
};

export class AppearanceSync {
  notice = $state('');
  loaded = $state(false);
  private item: Item | null = null;
  private last = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private saving = false;
  private wanted: Value | null = null;

  constructor(
    private store: ConfigStore,
    private apply: (value: Value) => void,
    private delay = 400,
  ) {}

  async load() {
    const result = await this.store.getDocument('settings', APPEARANCE_KEY);
    if (!result.ok) return;
    this.item = result.value;
    const value = read(result.value);
    if (value) {
      this.last = JSON.stringify(value);
      this.apply(value);
    }
    this.loaded = true;
  }

  /** Called with the current preferences; sends a change after a short pause, never the same value twice. */
  push(theme: string, locale: string) {
    if (!this.loaded) return;
    const value = { theme, locale };
    if (JSON.stringify(value) === this.last) {
      this.wanted = null;
      return;
    }
    this.wanted = value;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), this.delay);
  }

  async save() {
    const value = this.wanted;
    if (!value || this.saving) return;
    this.saving = true;
    try {
      this.notice = '';
      const result = await this.store.saveDocument('settings', APPEARANCE_KEY, value, this.item);
      if (result.ok) {
        this.item = result.value;
        this.last = JSON.stringify(value);
        this.wanted = null;
      } else if (result.code === 'version_conflict') {
        this.item = 'conflict' in result ? result.conflict : null;
        const server = read(this.item);
        if (server) {
          this.last = JSON.stringify(server);
          this.apply(server);
          this.notice = t('configStore.appearance.conflict');
        }
        this.wanted = null;
      } else this.notice = t('configStore.appearance.failed');
    } finally {
      this.saving = false;
    }
  }
  destroy() {
    clearTimeout(this.timer);
  }
}
