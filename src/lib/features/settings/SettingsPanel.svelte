<script lang="ts">
  import { t } from '$lib/i18n';
  import { formatDate, formatNumber } from '$lib/i18n/locale.svelte';
  import { preferences, updatePreferences, type Theme } from './preferences.svelte';
  const id = $props.id();
</script>

<section class="settings-panel editor-panel" aria-labelledby={`${id}-heading`} id="settings">
  <h2 id={`${id}-heading`}>{t('settings.title')}</h2>
  <p>{t('settings.localHint')}</p>
  <label for={`${id}-theme`}>{t('settings.theme')}</label>
  <select
    id={`${id}-theme`}
    value={preferences.theme}
    onchange={(event) => updatePreferences({ theme: event.currentTarget.value as Theme })}
  >
    <option value="system">{t('settings.system')}</option>
    <option value="light">{t('settings.light')}</option>
    <option value="dark">{t('settings.dark')}</option>
  </select>
  <label for={`${id}-language`}>{t('settings.language')}</label>
  <select
    id={`${id}-language`}
    value={preferences.locale}
    onchange={(event) =>
      updatePreferences({ locale: event.currentTarget.value === 'en' ? 'en' : 'de' })}
  >
    <option value="de" lang="de">Deutsch</option>
    <option value="en" lang="en">English</option>
  </select>
  <p>
    {t('settings.formatExample', {
      number: formatNumber(12345.6),
      date: formatDate(new Date(2026, 9, 26), { dateStyle: 'long' }),
    })}
  </p>
  <label class="settings-persist"
    ><input
      type="checkbox"
      checked={preferences.persist}
      onchange={(event) => updatePreferences({ persist: event.currentTarget.checked })}
    />{t('settings.persist')}</label
  >
  <button
    type="button"
    onclick={() => updatePreferences({ theme: 'system', locale: 'de', persist: false })}
    >{t('settings.reset')}</button
  >
  {#if preferences.storageFailed}<p role="status">{t('settings.storageFailed')}</p>{/if}
</section>
