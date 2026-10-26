<script lang="ts">
  import { Database, LockKeyhole, ArrowRight, LoaderCircle } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Dialog from '$lib/components/ui/dialog';
  import { t } from '$lib/i18n';
  import { emptyConnection, type ConnectionDraft, type Driver } from '$lib/workbench';

  let {
    open = $bindable(false),
    busy = false,
    message = '',
    onconnect,
    ontest,
    availableDrivers,
  }: {
    open?: boolean;
    busy?: boolean;
    message?: string;
    availableDrivers?: Driver[];
    onconnect: (draft: ConnectionDraft) => void;
    ontest: (draft: ConnectionDraft) => void;
  } = $props();
  let draft = $state(emptyConnection());
  const drivers: { value: Driver; title: string; detail: 'sqliteDetail' | 'serverDetail' }[] = [
    { value: 'sqlite', title: 'SQLite', detail: 'sqliteDetail' },
    { value: 'postgresql', title: 'PostgreSQL', detail: 'serverDetail' },
    { value: 'mysql', title: 'MySQL / MariaDB', detail: 'serverDetail' },
  ];
  function chooseDriver(driver: Driver) {
    draft.driver = driver;
    draft.port = driver === 'mysql' ? 3306 : 5432;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="connection-modal sm:max-w-[600px] max-h-[90dvh] overflow-y-auto p-7">
    <Dialog.Header>
      <div class="dialog-mark"><Database size={22} /></div>
      <Dialog.Title class="text-xl">{t('connectionEditor.title')}</Dialog.Title>
      <Dialog.Description>{t('connectionEditor.description')}</Dialog.Description>
    </Dialog.Header>
    <form
      autocomplete="off"
      onsubmit={(event) => {
        event.preventDefault();
        onconnect({ ...draft });
      }}
    >
      <fieldset disabled={busy} class="border-0 p-0 m-0">
        <legend class="field-label">{t('connectionEditor.driverLegend')}</legend>
        <div class="driver-options">
          {#each drivers as driver}
            <button
              type="button"
              class:selected={draft.driver === driver.value}
              aria-pressed={draft.driver === driver.value}
              disabled={availableDrivers !== undefined && !availableDrivers.includes(driver.value)}
              onclick={() => chooseDriver(driver.value)}
            >
              <strong>{driver.title}</strong><span
                >{availableDrivers !== undefined && !availableDrivers.includes(driver.value)
                  ? t('connectionEditor.unavailable')
                  : t(`connectionEditor.${driver.detail}`)}</span
              >
            </button>
          {/each}
        </div>
        <div class="form-field">
          <label for="connection-name"
            >{t('connectionEditor.name')}
            <span class="optional">{t('connectionEditor.optional')}</span></label
          ><Input
            id="connection-name"
            bind:value={draft.name}
            placeholder={t('connectionEditor.namePlaceholder')}
            maxlength={120}
          />
        </div>
        {#if draft.driver !== 'sqlite'}
          <div class="form-grid host-grid">
            <div class="form-field">
              <label for="connection-host">{t('connectionEditor.host')}</label><Input
                id="connection-host"
                bind:value={draft.host}
                required
                spellcheck={false}
                autocomplete="off"
              />
            </div>
            <div class="form-field">
              <label for="connection-port">{t('connectionEditor.port')}</label><Input
                id="connection-port"
                type="number"
                min="1"
                max="65535"
                bind:value={draft.port}
                required
              />
            </div>
          </div>
        {/if}
        <div class="form-field">
          <label for="connection-database">{t('connectionEditor.database')}</label><Input
            id="connection-database"
            bind:value={draft.database}
            placeholder={draft.driver === 'sqlite'
              ? t('connectionEditor.sqliteDatabasePlaceholder')
              : t('connectionEditor.databasePlaceholder')}
            pattern={draft.driver === 'sqlite' ? '[A-Za-z0-9][A-Za-z0-9_-]{0,63}' : undefined}
            required
            spellcheck={false}
            autocomplete="off"
          />
        </div>
        {#if draft.driver !== 'sqlite'}
          <div class="form-grid">
            <div class="form-field">
              <label for="connection-user">{t('connectionEditor.user')}</label><Input
                id="connection-user"
                bind:value={draft.username}
                required
                autocomplete="off"
                spellcheck={false}
              />
            </div>
            <div class="form-field">
              <label for="connection-password">{t('connectionEditor.password')}</label><Input
                id="connection-password"
                type="password"
                bind:value={draft.password}
                autocomplete="new-password"
              />
            </div>
          </div>
          <div class="privacy-note">
            <LockKeyhole size={15} /><span>{t('connectionEditor.tlsNote')}</span>
          </div>
        {/if}
        <div class="privacy-note">
          <LockKeyhole size={15} /><span>{t('connectionEditor.memoryNote')}</span>
        </div>
        {#if availableDrivers?.length === 0}<p class="form-message" role="status">
            {t('connectionEditor.noDrivers')}
          </p>{/if}{#if message}<p class="form-message" role="status">{message}</p>{/if}
        <div class="dialog-actions">
          <Button
            variant="outline"
            type="button"
            disabled={busy ||
              !draft.database.trim() ||
              (availableDrivers !== undefined && !availableDrivers.includes(draft.driver))}
            onclick={() => ontest({ ...draft })}
            >{#if busy}<LoaderCircle class="animate-spin" />{/if}{t(
              'connectionEditor.test',
            )}</Button
          ><Button
            type="submit"
            disabled={busy ||
              !draft.database.trim() ||
              (availableDrivers !== undefined && !availableDrivers.includes(draft.driver))}
            >{t('connectionEditor.connect')} <ArrowRight /></Button
          >
        </div>
      </fieldset>
    </form>
  </Dialog.Content>
</Dialog.Root>
