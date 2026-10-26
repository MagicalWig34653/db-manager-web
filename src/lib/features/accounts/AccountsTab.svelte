<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { toConnection } from '$lib/api';
  import { t } from '$lib/i18n';
  import type { FeatureProps } from '$lib/features';
  import { getShellContext } from '$lib/shell/context';
  import PlanPreview from '$lib/components/shared/PlanPreview.svelte';
  import { accountsClient, errorMessage } from './client';
  import {
    actions,
    scopes,
    privileges,
    accountLabel,
    type Action,
    type AccountRef,
    type Grant,
    type Schemas,
  } from './model';
  import { Operation } from './operation.svelte';

  let { connection, token, onwritephase }: FeatureProps = $props();
  const shell = getShellContext();
  const uid = $props.id();
  let caps = $state<Schemas['AccountsCapabilities'] | null>(null);
  let access = $state<Schemas['AccountAccess'] | null>(null);
  let accounts = $state<Schemas['AccountsResult'] | null>(null);
  let details = $state<Schemas['AccountDetails'] | null>(null);
  let selected = $state<AccountRef | null>(null);
  let busy = $state(false);
  let inspecting = $state(false);
  let error = $state('');
  let detailError = $state('');
  let offset = $state(0);
  let action = $state<Action>('create');
  let newName = $state('');
  let newHost = $state('%');
  let roleName = $state('');
  let roleHost = $state('%');
  let scope = $state<Grant['scope']>('global');
  let privilege = $state<Grant['privilege']>('SELECT');
  let database = $state('');
  let schema = $state('');
  let object = $state('');
  let column = $state('');
  let routineKind = $state<'function' | 'procedure'>('function');
  let routineId = $state('');
  let grantOption = $state(false);
  let confirmed = $state(false);
  let typedName = $state('');
  let acknowledgeSelf = $state(false);
  let secret = $state('');
  let secretInput = $state<HTMLInputElement>();
  let generation = 0;
  let inspectGeneration = 0;
  let controller: AbortController | null = null;
  let inspectController: AbortController | null = null;

  const driver = $derived(connection ? toConnection(connection).driver : 'sqlite');
  const writeBusy = $derived(!!shell?.session.writeInFlight);
  const support = (key: Action | 'list' | 'inspect') => caps?.drivers[driver][key];
  const allowed = (key: Action) =>
    support(key)?.support !== 'unsupported' && !!support(key) && !!access?.actions.includes(key);
  const operation = new Operation({
    context: () => ({ connection: connection ? toConnection(connection) : null, token }),
    receiver: () => onwritephase,
    blocked: () => writeBusy,
    onfinished: () => {
      secret = '';
      void refresh(offset);
    },
  });
  const frozen = $derived(operation.phase !== 'idle');
  function clearConfirmation() {
    confirmed = false;
    typedName = '';
    acknowledgeSelf = false;
    secret = '';
  }
  function resetDraft() {
    operation.reset();
    clearConfirmation();
    newName = '';
    newHost = '%';
    roleName = '';
    roleHost = '%';
    scope = 'global';
    privilege = 'SELECT';
    database = '';
    schema = '';
    object = '';
    column = '';
    routineId = '';
    routineKind = 'function';
    grantOption = false;
  }
  async function refresh(nextOffset = 0) {
    if (!connection || busy || operation.phase === 'executing' || writeBusy) return;
    const current = ++generation;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const source = toConnection(connection);
    const credential = token;
    busy = true;
    error = '';
    details = null;
    detailError = '';
    inspectController?.abort();
    inspectGeneration++;
    try {
      const capabilities = await accountsClient.capabilities(credential, signal);
      if (current !== generation) return;
      caps = capabilities;
      if (capabilities.drivers[source.driver].list.support === 'unsupported') {
        accounts = null;
        access = null;
        return;
      }
      const rights = await accountsClient.access({ connection: source }, credential, signal);
      if (current !== generation) return;
      access = rights;
      const result = await accountsClient.list(
        { connection: source, offset: nextOffset, limit: 100 },
        credential,
        signal,
      );
      if (current !== generation) return;
      accounts = result;
      offset = nextOffset;
      if (selected) {
        const match = result.accounts.find(
          (item) => item.account.name === selected?.name && item.account.host === selected?.host,
        );
        selected = match?.account ?? null;
        if (selected) void inspect(selected);
      }
    } catch (cause) {
      if (current === generation && !signal.aborted) {
        error = errorMessage(cause);
        access = null;
        accounts = null;
      }
    } finally {
      if (current === generation) busy = false;
    }
  }
  async function inspect(account: AccountRef) {
    const current = ++inspectGeneration;
    inspectController?.abort();
    inspectController = new AbortController();
    const signal = inspectController.signal;
    selected = account;
    details = null;
    detailError = '';
    inspecting = true;
    if (!connection || support('inspect')?.support === 'unsupported') {
      inspecting = false;
      return;
    }
    try {
      const result = await accountsClient.inspect(
        { connection: toConnection(connection), account },
        token,
        signal,
      );
      if (current === inspectGeneration) details = result;
    } catch (cause) {
      if (current === inspectGeneration && !signal.aborted) detailError = errorMessage(cause);
    } finally {
      if (current === inspectGeneration) inspecting = false;
    }
  }
  function choose(account: AccountRef) {
    if (writeBusy || operation.phase === 'executing' || operation.phase === 'planning') return;
    resetDraft();
    void inspect(account);
  }
  function grant(): Grant {
    return {
      scope,
      privilege,
      grant_option: grantOption,
      ...(scope !== 'global' ? { database } : {}),
      ...(['table', 'column', 'routine'].includes(scope)
        ? { object, ...(driver === 'postgres' ? { schema } : {}) }
        : {}),
      ...(scope === 'column' ? { column } : {}),
      ...(scope === 'routine'
        ? { routine_kind: routineKind, ...(driver === 'postgres' ? { routine_id: routineId } : {}) }
        : {}),
    };
  }
  async function plan() {
    if (
      !allowed(action) ||
      busy ||
      writeBusy ||
      (action !== 'create' && action !== 'flush' && !selected)
    )
      return;
    clearConfirmation();
    const fields: Record<string, unknown> = {};
    if (action !== 'create' && action !== 'flush') fields.account = selected;
    if (['create', 'rename', 'copy'].includes(action))
      fields.new_account = { name: newName, ...(driver === 'mysql' ? { host: newHost } : {}) };
    if (action === 'grant' || action === 'revoke') fields.grant = grant();
    if (action === 'role_grant' || action === 'role_revoke')
      fields.role = { name: roleName, ...(driver === 'mysql' ? { host: roleHost } : {}) };
    await operation.loadPlan(action, fields);
  }
  function execute() {
    if (!operation.canExecute(confirmed, typedName, acknowledgeSelf, secret)) return;
    const pending = operation.execute(confirmed, typedName, acknowledgeSelf, secret);
    secret = '';
    // The planned block unmounts on send; clear the field itself so no detached node keeps the value.
    if (secretInput) secretInput.value = '';
    clearConfirmation();
    void pending;
  }
  function useGrant(value: Grant) {
    if (frozen || writeBusy) return;
    action = 'revoke';
    scope = value.scope;
    privilege = value.privilege;
    grantOption = false;
    database = value.database ?? '';
    schema = value.schema ?? '';
    object = value.object ?? '';
    column = value.column ?? '';
    routineKind = value.routine_kind ?? 'function';
    routineId = value.routine_id ?? '';
  }
  $effect(() => {
    const source = connection;
    const credential = token;
    untrack(() => {
      generation++;
      inspectGeneration++;
      controller?.abort();
      inspectController?.abort();
      busy = false;
      inspecting = false;
      caps = null;
      access = null;
      accounts = null;
      details = null;
      selected = null;
      error = '';
      detailError = '';
      offset = 0;
      resetDraft();
      action = 'create';
      if (source) void refresh();
    });
    return () => {
      generation++;
      inspectGeneration++;
      controller?.abort();
      inspectController?.abort();
      operation.reset();
      secret = '';
    };
  });
  const shown = (value: string | boolean | null) =>
    value === null
      ? t('accounts.unknownValue')
      : typeof value === 'boolean'
        ? t(value ? 'accounts.yes' : 'accounts.no')
        : value;
</script>

<section class="accounts-panel" aria-label={t('accounts.title')}>
  <h2>{t('accounts.title')}</h2>
  <p>{t('accounts.boundary')}</p>
  {#if !connection}<p>{t('server.noConnection')}</p>
  {:else}
    {#if error}<p role="alert">{error}</p>{/if}
    {#if busy || inspecting}<p role="status">{t('shared.loading')}</p>{/if}
    {#if caps}
      {#if driver === 'sqlite'}<p data-testid="accounts-unsupported">{t('accounts.sqlite')}</p>{/if}
      <details>
        <summary>{t('accounts.capabilities')}</summary>
        <ul>
          {#each ['list', 'inspect', ...actions] as key}
            {@const capability = support(key as Action | 'list' | 'inspect')}
            <li>
              {t(`accounts.actions.${key}`)}: {t(
                `accounts.support.${capability?.support ?? 'unsupported'}`,
              )}
              {capability?.reason ?? ''}
              {#if actions.includes(key as Action) && !access?.actions.includes(key as Action)}
                — {t('accounts.notAllowed')}{/if}
            </li>
          {/each}
        </ul>
      </details>
    {/if}
    {#each access?.notes ?? [] as note}<p>{note}</p>{/each}
    <button onclick={() => refresh(offset)} disabled={busy || frozen || writeBusy}
      >{t('accounts.refresh')}</button
    >
    {#if accounts}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable table needs a keyboard focus target.) -->
      <div class="table-scroll" role="region" tabindex="0" aria-label={t('accounts.list')}>
        <table class="result-table" data-testid="account-list">
          <caption>{t('accounts.list')}</caption>
          <thead
            ><tr
              >{#each ['name', 'host', 'plugin', 'locked', 'ssl', 'limits', 'attributes'] as key}<th
                  scope="col">{t(`accounts.${key}`)}</th
                >{/each}</tr
            ></thead
          >
          <tbody
            >{#each accounts.accounts as item}
              <tr
                ><th scope="row"
                  ><button
                    disabled={writeBusy ||
                      operation.phase === 'planning' ||
                      operation.phase === 'executing'}
                    aria-pressed={selected?.name === item.account.name &&
                      selected?.host === item.account.host}
                    onclick={() => choose(item.account)}>{item.account.name}</button
                  >
                  {item.current ? t('accounts.current') : ''}</th
                >
                <td>{item.account.host ?? t('accounts.notApplicable')}</td><td
                  >{shown(item.auth_plugin)}</td
                ><td>{shown(item.locked)}</td><td>{shown(item.ssl_type)}</td>
                <td
                  >{#each Object.entries(item.limits) as [name, value]}<div>
                      {name}: {value}
                    </div>{/each}</td
                >
                <td>{item.attributes.join(', ')} {t('accounts.login')}: {shown(item.login)}</td>
              </tr>
            {/each}</tbody
          >
        </table>
      </div>
      <p>{t('accounts.page', { offset, count: accounts.accounts.length })}</p>
      {#if accounts.truncated}<p>{t('accounts.truncated')}</p>{/if}
      <button
        disabled={!offset || busy || frozen || writeBusy}
        onclick={() => refresh(Math.max(0, offset - 100))}>{t('accounts.previous')}</button
      >
      <button
        disabled={!accounts.truncated || busy || frozen || writeBusy}
        onclick={() => refresh(offset + 100)}>{t('accounts.next')}</button
      >
    {/if}
    {#if selected}<h3>{t('accounts.details')}: {accountLabel(selected)}</h3>{/if}
    {#if detailError}<p role="alert">{detailError}</p>{/if}
    {#if details}
      <p>{t('accounts.directOnly')}</p>
      {#each details.notes as note}<p>{note}</p>{/each}
      {#each scopes as group}
        <h4>{t(`accounts.scopes.${group}`)}</h4>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable table needs a keyboard focus target.) -->
        <div
          class="table-scroll"
          role="region"
          tabindex="0"
          aria-label={`${t('accounts.privilege')}: ${t(`accounts.scopes.${group}`)}`}
        >
          <table class="result-table" data-testid={`grants-${group}`}>
            <caption class="sr-only">{t(`accounts.scopes.${group}`)}</caption>
            <thead
              ><tr
                ><th>{t('accounts.target')}</th><th>{t('accounts.privilege')}</th><th
                  >{t('accounts.grantOption')}</th
                ><th>{t('accounts.action')}</th></tr
              ></thead
            >
            <tbody
              >{#each details.grants.filter((value) => value.scope === group) as value}<tr>
                  <td
                    >{[
                      value.database,
                      value.schema,
                      value.object,
                      value.column,
                      value.routine_kind,
                      value.routine_id,
                    ]
                      .filter(Boolean)
                      .join(' / ') || t('accounts.scopes.global')}</td
                  >
                  <td>{value.privilege}</td><td>{shown(value.grant_option)}</td><td
                    ><button
                      disabled={frozen || writeBusy || !allowed('revoke')}
                      onclick={() => useGrant(value)}>{t('accounts.prepareRevoke')}</button
                    ></td
                  >
                </tr>{:else}<tr><td colspan="4">{t('accounts.none')}</td></tr>{/each}</tbody
            >
          </table>
        </div>
      {/each}
      <h4>{t('accounts.roles')}</h4>
      <ul>
        {#each details.roles as role}<li>{accountLabel(role)}</li>{:else}<li>
            {t('accounts.none')}
          </li>{/each}
      </ul>
    {/if}
    {#if caps && driver !== 'sqlite'}
      <fieldset disabled={frozen || busy || writeBusy}>
        <legend>{t('accounts.edit')}</legend>
        <label for={`${uid}-action`}>{t('accounts.action')}</label><select
          id={`${uid}-action`}
          bind:value={action}
        >
          {#each actions as key}<option value={key} disabled={!allowed(key)}
              >{t(`accounts.actions.${key}`)}</option
            >{/each}
        </select>
        <p>{support(action)?.reason ?? ''} {allowed(action) ? '' : t('accounts.notAllowed')}</p>
        {#if action !== 'create' && action !== 'flush'}<p>
            {t('accounts.selected')}: {selected ? accountLabel(selected) : t('accounts.choose')}
          </p>{/if}
        {#if ['create', 'rename', 'copy'].includes(action)}
          <label for={`${uid}-name`}>{t('accounts.newName')}</label><input
            id={`${uid}-name`}
            bind:value={newName}
          />
          {#if driver === 'mysql'}<label for={`${uid}-host`}>{t('accounts.newHost')}</label><input
              id={`${uid}-host`}
              bind:value={newHost}
            />{/if}
        {/if}
        {#if action === 'copy'}<p>{t('accounts.copyBoundary')}</p>{/if}
        {#if action === 'flush'}<p>{t('accounts.flushBoundary')}</p>{/if}
        {#if action === 'role_grant' || action === 'role_revoke'}
          <label for={`${uid}-role`}>{t('accounts.role')}</label><input
            id={`${uid}-role`}
            bind:value={roleName}
          />
          {#if driver === 'mysql'}<label for={`${uid}-role-host`}>{t('accounts.host')}</label><input
              id={`${uid}-role-host`}
              bind:value={roleHost}
            />{/if}
        {/if}
        {#if action === 'grant' || action === 'revoke'}
          <label for={`${uid}-scope`}>{t('accounts.scope')}</label><select
            id={`${uid}-scope`}
            bind:value={scope}
            >{#each scopes as key}<option value={key}>{t(`accounts.scopes.${key}`)}</option
              >{/each}</select
          >
          <label for={`${uid}-privilege`}>{t('accounts.privilege')}</label><select
            id={`${uid}-privilege`}
            bind:value={privilege}
            >{#each privileges as key}<option>{key}</option>{/each}</select
          >
          {#if scope !== 'global'}<label for={`${uid}-database`}>{t('accounts.database')}</label
            ><input id={`${uid}-database`} bind:value={database} />{/if}
          {#if ['table', 'column', 'routine'].includes(scope)}
            {#if driver === 'postgres'}<label for={`${uid}-schema`}>{t('accounts.schema')}</label
              ><input id={`${uid}-schema`} bind:value={schema} />{/if}
            <label for={`${uid}-object`}>{t('accounts.object')}</label><input
              id={`${uid}-object`}
              bind:value={object}
            />
          {/if}
          {#if scope === 'column'}<label for={`${uid}-column`}>{t('accounts.column')}</label><input
              id={`${uid}-column`}
              bind:value={column}
            />{/if}
          {#if scope === 'routine'}
            <label for={`${uid}-kind`}>{t('accounts.routineKind')}</label><select
              id={`${uid}-kind`}
              bind:value={routineKind}
              ><option value="function">{t('accounts.function')}</option><option value="procedure"
                >{t('accounts.procedure')}</option
              ></select
            >
            {#if driver === 'postgres'}<label for={`${uid}-oid`}>{t('accounts.routineId')}</label
              ><input id={`${uid}-oid`} bind:value={routineId} inputmode="numeric" />{/if}
          {/if}
          <label
            ><input type="checkbox" bind:checked={grantOption} />{t('accounts.grantOption')}</label
          >
          {#if action === 'revoke'}<p>{t('accounts.revokeOption')}</p>{/if}
          <p>{t('accounts.catalogCheck')}</p>
        {/if}
        <button
          onclick={plan}
          disabled={!allowed(action) || (action !== 'create' && action !== 'flush' && !selected)}
          >{t('accounts.plan')}</button
        >
      </fieldset>
    {/if}
    {#if operation.phase === 'planning'}<p role="status">{t('accounts.planning')}</p>{/if}
    {#if operation.error}<p role={operation.unknown ? undefined : 'alert'}>
        {operation.error}
      </p>{/if}
    {#if operation.plan}
      <PlanPreview
        statements={operation.plan.statements}
        warnings={operation.plan.warnings}
        planSha256={operation.plan.plan_sha256}
      />
      <p>{t('accounts.transaction')}</p>
      <h4>{t('accounts.affected')}</h4>
      <ul>
        {#each operation.plan.affected_objects as value}<li>{value}</li>{/each}
      </ul>
      {#if operation.phase === 'planned'}
        <fieldset disabled={writeBusy}>
          <legend>{t('accounts.confirmation')}</legend>
          <label><input type="checkbox" bind:checked={confirmed} />{t('accounts.confirm')}</label>
          {#if operation.plan.destructive}
            <p>
              {t('accounts.typeTarget')}: <code>{operation.plan.confirmation.target_name}</code>
            </p>
            <label for={`${uid}-typed`}>{t('accounts.typedName')}</label><input
              id={`${uid}-typed`}
              bind:value={typedName}
              autocomplete="off"
            />
          {/if}
          {#if operation.plan.self}<label
              ><input type="checkbox" bind:checked={acknowledgeSelf} />{t(
                'accounts.selfConfirm',
              )}</label
            >{/if}
          {#if operation.plan.requires_secret}
            <p>{t('accounts.secretBoundary')}</p>
            <label for={`${uid}-secret`}>{t('accounts.secret')}</label><input
              id={`${uid}-secret`}
              type="password"
              autocomplete="new-password"
              bind:value={secret}
              bind:this={secretInput}
            />
          {/if}
          <button
            disabled={!operation.canExecute(confirmed, typedName, acknowledgeSelf, secret)}
            onclick={execute}>{t('accounts.execute')}</button
          >
        </fieldset>
      {/if}
    {/if}
    {#if operation.phase === 'executing'}<p role="status">{t('accounts.executing')}</p>{/if}
    {#if operation.result}
      <p role="status">
        {t(`accounts.outcomes.${operation.result.outcome}`)}
        {operation.result.reason ? t(`accounts.${operation.result.reason}`) : ''}
      </p>
      {#if operation.result.message}<p data-testid="account-result-message">
          {operation.result.message}
        </p>{/if}
      <p>
        {t('accounts.executed', { count: operation.result.statements_executed })}
        {t(operation.result.atomic ? 'accounts.atomic' : 'accounts.nonAtomic')}
      </p>
    {/if}
    {#if operation.unknown}<p role="alert">{t('accounts.unknown')}</p>{/if}
    {#if operation.phase === 'finished'}<p>{t('accounts.lockedAfter')}</p>{/if}
    {#if frozen}<button
        disabled={operation.phase === 'executing' || operation.phase === 'planning' || writeBusy}
        onclick={resetDraft}>{t('accounts.newPlan')}</button
      >{/if}
  {/if}
</section>

<style>
  .accounts-panel {
    padding: 1rem;
    display: grid;
    gap: 0.75rem;
    min-width: 0;
  }
  fieldset {
    display: grid;
    gap: 0.5rem;
    min-width: 0;
    padding: 0.75rem;
    border: 1px solid var(--border);
  }
  input:not([type='checkbox']),
  select {
    max-width: 100%;
    min-width: 0;
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.25rem;
    background: var(--background);
    color: inherit;
  }
  button {
    padding: 0.4rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 0.25rem;
    cursor: pointer;
    width: fit-content;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  p,
  li,
  td,
  th,
  code {
    overflow-wrap: anywhere;
  }
  .table-scroll {
    max-width: 100%;
    overflow-x: auto;
  }
  table {
    width: 100%;
  }
  td {
    white-space: normal;
  }
</style>
