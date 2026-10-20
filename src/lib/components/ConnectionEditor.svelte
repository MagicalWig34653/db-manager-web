<script lang="ts">
  import { Database, LockKeyhole, ArrowRight, LoaderCircle } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Dialog from '$lib/components/ui/dialog';
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
  const drivers: { value: Driver; title: string; detail: string }[] = [
    { value: 'sqlite', title: 'SQLite', detail: 'Dateidatenbank' },
    { value: 'postgresql', title: 'PostgreSQL', detail: 'Serververbindung' },
    { value: 'mysql', title: 'MySQL / MariaDB', detail: 'Serververbindung' },
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
      <Dialog.Title class="text-xl">Verbindung hinzufügen</Dialog.Title>
      <Dialog.Description>Wähle deine Datenbank und öffne einen Arbeitsbereich.</Dialog.Description>
    </Dialog.Header>
    <form
      autocomplete="off"
      onsubmit={(event) => {
        event.preventDefault();
        onconnect({ ...draft });
      }}
    >
      <fieldset disabled={busy} class="border-0 p-0 m-0">
        <legend class="field-label">Datenbanksystem</legend>
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
                  ? 'Nicht verfügbar'
                  : driver.detail}</span
              >
            </button>
          {/each}
        </div>
        <div class="form-field">
          <label for="connection-name">Name <span class="optional">optional</span></label><Input
            id="connection-name"
            bind:value={draft.name}
            placeholder="Zum Beispiel: Entwicklung"
            maxlength={120}
          />
        </div>
        {#if draft.driver !== 'sqlite'}
          <div class="form-grid host-grid">
            <div class="form-field">
              <label for="connection-host">Host</label><Input
                id="connection-host"
                bind:value={draft.host}
                required
                spellcheck={false}
                autocomplete="off"
              />
            </div>
            <div class="form-field">
              <label for="connection-port">Port</label><Input
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
          <label for="connection-database">Datenbank</label><Input
            id="connection-database"
            bind:value={draft.database}
            placeholder={draft.driver === 'sqlite'
              ? 'Freigegebener Datenbankname'
              : 'Datenbankname'}
            pattern={draft.driver === 'sqlite' ? '[A-Za-z0-9][A-Za-z0-9_-]{0,63}' : undefined}
            required
            spellcheck={false}
            autocomplete="off"
          />
        </div>
        {#if draft.driver !== 'sqlite'}
          <div class="form-grid">
            <div class="form-field">
              <label for="connection-user">Benutzername</label><Input
                id="connection-user"
                bind:value={draft.username}
                required
                autocomplete="off"
                spellcheck={false}
              />
            </div>
            <div class="form-field">
              <label for="connection-password">Passwort</label><Input
                id="connection-password"
                type="password"
                bind:value={draft.password}
                autocomplete="new-password"
              />
            </div>
          </div>
          <div class="privacy-note">
            <LockKeyhole size={15} /><span
              >Serververbindungen verwenden geprüftes TLS. Ein unsicherer Fallback ist
              ausgeschlossen.</span
            >
          </div>
        {/if}
        <div class="privacy-note">
          <LockKeyhole size={15} /><span
            >Zugangsdaten bleiben nur für diese Sitzung im Arbeitsspeicher.</span
          >
        </div>
        {#if availableDrivers?.length === 0}<p class="form-message" role="status">
            Dieses Backend bietet derzeit keine Datenbanktreiber an.
          </p>{/if}{#if message}<p class="form-message" role="status">{message}</p>{/if}
        <div class="dialog-actions">
          <Button
            variant="outline"
            type="button"
            disabled={busy ||
              !draft.database.trim() ||
              (availableDrivers !== undefined && !availableDrivers.includes(draft.driver))}
            onclick={() => ontest({ ...draft })}
            >{#if busy}<LoaderCircle class="animate-spin" />{/if}Verbindung testen</Button
          ><Button
            type="submit"
            disabled={busy ||
              !draft.database.trim() ||
              (availableDrivers !== undefined && !availableDrivers.includes(draft.driver))}
            >Verbinden <ArrowRight /></Button
          >
        </div>
      </fieldset>
    </form>
  </Dialog.Content>
</Dialog.Root>
