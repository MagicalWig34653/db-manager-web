<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Database, Server } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import CapabilityNotice from '$lib/components/shared/CapabilityNotice.svelte';
  import ErrorPanel from '$lib/components/shared/ErrorPanel.svelte';
  import { t } from '$lib/i18n';
  import type { FeatureProps } from '$lib/features';
  import { formatRoute } from '$lib/shell/router';
  import {
    driverCapability,
    formatBytes,
    formatCount,
    formatDuration,
    overviewClient,
    type DatabaseInfo,
    type DatabasesResult,
    type OverviewCapabilities,
    type ServerInfoResult,
  } from './client';
  import { Resource } from './resource.svelte';

  let { connection, token }: Pick<FeatureProps, 'connection' | 'token'> = $props();

  const capabilities = new Resource<OverviewCapabilities>();
  const info = new Resource<ServerInfoResult>();
  const databases = new Resource<DatabasesResult>();
  let moreDatabases = $state<DatabaseInfo[]>([]);
  let loadingMore = $state(false);

  const infoCap = $derived(
    connection && capabilities.data
      ? driverCapability(capabilities.data, connection, 'server_info')
      : null,
  );
  const databasesCap = $derived(
    connection && capabilities.data
      ? driverCapability(capabilities.data, connection, 'databases')
      : null,
  );
  const allDatabases = $derived([...(databases.data?.databases ?? []), ...moreDatabases]);
  const sessionVariables = $derived(info.data?.session ?? []);

  async function load(current: NonNullable<typeof connection>, secret: string) {
    moreDatabases = [];
    info.reset();
    databases.reset();
    const caps = await capabilities.run(
      (signal) => overviewClient.capabilities(secret, signal),
      t('overview.loadFailed'),
    );
    if (!caps) return;
    const driver = (feature: 'server_info' | 'databases') =>
      driverCapability(caps, current, feature).support !== 'unsupported';
    await Promise.all([
      driver('server_info')
        ? info.run(
            (signal) => overviewClient.serverInfo(current, secret, signal),
            t('serverInfo.loadFailed'),
          )
        : null,
      driver('databases')
        ? databases.run(
            (signal) => overviewClient.databases(current, secret, {}, signal),
            t('overview.databasesFailed'),
          )
        : null,
    ]);
  }

  async function loadMore() {
    if (!connection || !databases.data) return;
    const source = connection;
    const base = databases.data;
    loadingMore = true;
    try {
      const next = await overviewClient.databases(source, token, { offset: allDatabases.length });
      if (source === connection && base === databases.data)
        moreDatabases = [...moreDatabases, ...next.databases];
    } catch {
      /* the visible list stays as it is; the user can retry */
    } finally {
      loadingMore = false;
    }
  }

  $effect(() => {
    const current = connection;
    const secret = token;
    if (!current) return;
    untrack(() => void load(current, secret));
    return () => {
      capabilities.abort();
      info.abort();
      databases.abort();
    };
  });

  const driverNames = { sqlite: 'SQLite', mysql: 'MySQL', postgres: 'PostgreSQL' } as const;
  const variantNames = {
    sqlite: 'SQLite',
    mysql: 'MySQL',
    mariadb: 'MariaDB',
    postgres: 'PostgreSQL',
  } as const;
  const shown = (value: string | null) => value ?? t('overview.unknown');
</script>

<section class="overview-panel" aria-label={t('serverInfo.title')} data-testid="server-info">
  <div class="panel-heading">
    <div class="query-tab"><Server size={17} /><strong>{t('serverInfo.title')}</strong></div>
  </div>

  {#if !connection}
    <p class="catalog-message">{t('server.noConnection')}</p>
  {:else}
    {#if capabilities.error}
      <ErrorPanel
        message={capabilities.error}
        onretry={() => connection && load(connection, token)}
      />
    {/if}
    {#if infoCap && infoCap.support !== 'supported'}
      <CapabilityNotice
        title={infoCap.support === 'unsupported'
          ? t('overview.unsupportedTitle')
          : t('overview.limitedTitle')}
        reason={infoCap.reason ?? t('shared.unsupportedReason')}
      />
    {/if}

    <div class="table-facts" data-testid="server-context">
      <span
        >{t('server.driverLabel')}: {driverNames[
          connection.driver === 'postgresql' ? 'postgres' : connection.driver
        ]}</span
      >
      <span>{t('server.databaseLabel')}: {connection.database}</span>
      {#if info.data}
        <span>{t('serverInfo.version')}: {variantNames[info.data.variant]} {info.data.version}</span
        >
        {#if info.data.uptime_seconds !== null}
          <span>{t('serverInfo.uptime')}: {formatDuration(info.data.uptime_seconds)}</span>
        {/if}
      {/if}
    </div>

    {#if info.busy}<p class="catalog-message" role="status">{t('overview.loading')}</p>{/if}
    {#if info.error}
      <ErrorPanel
        title={t('serverInfo.loadFailedTitle')}
        message={info.error}
        onretry={() => connection && load(connection, token)}
      />
    {/if}
    {#if info.data}
      {@const data = info.data}
      <dl class="overview-facts" data-testid="server-facts">
        <div>
          <dt>{t('serverInfo.variant')}</dt>
          <dd>{variantNames[data.variant]}</dd>
        </div>
        <div>
          <dt>{t('serverInfo.version')}</dt>
          <dd>{data.version}</dd>
        </div>
        {#if data.version_comment}
          <div>
            <dt>{t('serverInfo.versionComment')}</dt>
            <dd>{data.version_comment}</dd>
          </div>
        {/if}
        <div>
          <dt>{t('serverInfo.currentDatabase')}</dt>
          <dd>{shown(data.current_database)}</dd>
        </div>
        {#if data.connection.host}
          <div>
            <dt>{t('serverInfo.host')}</dt>
            <dd>{data.connection.host}{data.connection.port ? `:${data.connection.port}` : ''}</dd>
          </div>
        {/if}
        {#if data.connection.username}
          <div>
            <dt>{t('serverInfo.user')}</dt>
            <dd>{data.connection.username}</dd>
          </div>
        {/if}
        {#if data.connection.tls_mode && data.driver !== 'sqlite'}
          <div>
            <dt>{t('serverInfo.tls')}</dt>
            <dd>{data.connection.tls_mode}</dd>
          </div>
        {/if}
        {#each sessionVariables as variable (variable.name)}
          <div>
            <dt>{variable.name}</dt>
            <dd>{shown(variable.value)}</dd>
          </div>
        {/each}
      </dl>
    {/if}

    <h3 class="overview-heading"><Database size={15} />{t('overview.databasesTitle')}</h3>
    {#if databasesCap && databasesCap.support !== 'supported'}
      <CapabilityNotice
        title={databasesCap.support === 'unsupported'
          ? t('overview.unsupportedTitle')
          : t('overview.limitedTitle')}
        reason={databasesCap.reason ?? t('shared.unsupportedReason')}
      />
    {/if}
    {#if databases.busy}<p class="catalog-message" role="status">{t('overview.loading')}</p>{/if}
    {#if databases.error}
      <ErrorPanel
        title={t('overview.databasesFailedTitle')}
        message={databases.error}
        onretry={() => connection && load(connection, token)}
      />
    {/if}
    {#if databases.data}
      {#if allDatabases.length === 0}
        <p class="catalog-message">{t('overview.noDatabases')}</p>
      {:else}
        <div class="table-scroll">
          <table class="result-table" data-testid="database-table">
            <caption class="sr-only">{t('overview.databasesTitle')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('overview.colName')}</th>
                <th scope="col">{t('overview.colCharset')}</th>
                <th scope="col">{t('overview.colCollation')}</th>
                <th scope="col">{t('overview.colObjects')}</th>
                <th scope="col">{t('overview.colSize')}</th>
                <th scope="col">{t('overview.colValues')}</th>
              </tr>
            </thead>
            <tbody>
              {#each allDatabases as database (database.name)}
                <tr>
                  <th scope="row">
                    {#if database.current}
                      <a
                        href={formatRoute({
                          kind: 'database',
                          database: database.name,
                          tab: 'uebersicht',
                        })}>{database.name}</a
                      >
                      <Badge variant="secondary">{t('overview.current')}</Badge>
                    {:else}
                      <span title={t('overview.otherDatabaseHint')}>{database.name}</span>
                    {/if}
                    {#if database.system}<Badge variant="outline">{t('overview.system')}</Badge
                      >{/if}
                  </th>
                  <td>{shown(database.charset)}</td>
                  <td>{shown(database.collation)}</td>
                  <td class="numeric"
                    >{database.object_count === null
                      ? t('overview.unknown')
                      : formatCount(database.object_count)}</td
                  >
                  <td class="numeric"
                    >{database.size_bytes === null
                      ? t('overview.unknown')
                      : formatBytes(database.size_bytes)}</td
                  >
                  <td>
                    <Badge
                      variant={database.estimated ? 'outline' : 'secondary'}
                      data-testid="value-state"
                      >{database.estimated ? t('overview.estimated') : t('overview.exact')}</Badge
                    >
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if databases.data.has_more || databases.data.total > allDatabases.length}
          <p class="limit-note" data-testid="databases-limit">
            {t('overview.limitNote', { shown: allDatabases.length, total: databases.data.total })}
            <Button variant="outline" size="sm" onclick={loadMore} disabled={loadingMore}
              >{t('overview.loadMore')}</Button
            >
          </p>
        {/if}
      {/if}
    {/if}

    {#if info.data}
      {@const data = info.data}
      <h3 class="overview-heading">{t('serverInfo.charsetsTitle')}</h3>
      <details class="overview-details">
        <summary>{t('serverInfo.charsets', { n: data.character_sets.length })}</summary>
        {#if data.character_sets.length === 0}
          <p class="catalog-message">{t('serverInfo.none')}</p>
        {:else}
          <div class="table-scroll">
            <table class="result-table">
              <caption class="sr-only">{t('serverInfo.charsetsTitle')}</caption>
              <thead
                ><tr
                  ><th scope="col">{t('overview.colName')}</th><th scope="col"
                    >{t('serverInfo.defaultCollation')}</th
                  ><th scope="col">{t('serverInfo.description')}</th><th scope="col"
                    >{t('serverInfo.maxBytes')}</th
                  ></tr
                ></thead
              >
              <tbody>
                {#each data.character_sets as set (set.name)}
                  <tr
                    ><th scope="row">{set.name}</th><td>{shown(set.default_collation)}</td><td
                      >{shown(set.description)}</td
                    ><td class="numeric">{set.max_bytes ?? t('overview.unknown')}</td></tr
                  >
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
        {#if data.character_sets_truncated}<p class="limit-note">
            {t('serverInfo.truncated')}
          </p>{/if}
      </details>

      <details class="overview-details">
        <summary>{t('serverInfo.collations', { n: data.collations.length })}</summary>
        {#if data.collations.length === 0}
          <p class="catalog-message">{t('serverInfo.none')}</p>
        {:else}
          <div class="table-scroll">
            <table class="result-table">
              <caption class="sr-only">{t('serverInfo.collationsTitle')}</caption>
              <thead
                ><tr
                  ><th scope="col">{t('overview.colName')}</th><th scope="col"
                    >{t('overview.colCharset')}</th
                  ><th scope="col">{t('serverInfo.isDefault')}</th></tr
                ></thead
              >
              <tbody>
                {#each data.collations as collation (collation.name + (collation.charset ?? ''))}
                  <tr
                    ><th scope="row">{collation.name}</th><td>{shown(collation.charset)}</td><td
                      >{collation.default ? t('overview.yes') : ''}</td
                    ></tr
                  >
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
        {#if data.collations_truncated}<p class="limit-note">{t('serverInfo.truncated')}</p>{/if}
      </details>

      <details class="overview-details">
        <summary>{t('serverInfo.engines', { n: data.engines.length })}</summary>
        {#if data.engines.length === 0}
          <p class="catalog-message">{t('serverInfo.none')}</p>
        {:else}
          <div class="table-scroll">
            <table class="result-table">
              <caption class="sr-only">{t('serverInfo.enginesTitle')}</caption>
              <thead
                ><tr
                  ><th scope="col">{t('overview.colName')}</th><th scope="col"
                    >{t('serverInfo.support')}</th
                  ><th scope="col">{t('serverInfo.transactions')}</th><th scope="col"
                    >{t('serverInfo.description')}</th
                  ></tr
                ></thead
              >
              <tbody>
                {#each data.engines as engine (engine.name)}
                  <tr
                    ><th scope="row">{engine.name}</th><td>{engine.support}</td><td
                      >{shown(engine.transactions)}</td
                    ><td>{shown(engine.comment)}</td></tr
                  >
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </details>

      <details class="overview-details">
        <summary>{t('serverInfo.plugins', { n: data.plugins.length })}</summary>
        {#if data.plugins.length === 0}
          <p class="catalog-message">{t('serverInfo.none')}</p>
        {:else}
          <div class="table-scroll">
            <table class="result-table">
              <caption class="sr-only">{t('serverInfo.pluginsTitle')}</caption>
              <thead
                ><tr
                  ><th scope="col">{t('overview.colName')}</th><th scope="col"
                    >{t('serverInfo.type')}</th
                  ><th scope="col">{t('serverInfo.status')}</th><th scope="col"
                    >{t('serverInfo.pluginVersion')}</th
                  ></tr
                ></thead
              >
              <tbody>
                {#each data.plugins as plugin (plugin.name + plugin.type)}
                  <tr
                    ><th scope="row">{plugin.name}</th><td>{plugin.type}</td><td>{plugin.status}</td
                    ><td>{shown(plugin.version)}</td></tr
                  >
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
        {#if data.plugins_truncated}<p class="limit-note">{t('serverInfo.truncated')}</p>{/if}
      </details>
    {/if}
  {/if}
</section>

<style>
  .overview-facts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 8px 16px;
    margin: 0;
    padding: 12px 16px;
    font-size: 11px;
  }
  .overview-facts dt {
    color: #91a0b7;
  }
  .overview-facts dd {
    margin: 2px 0 0;
    overflow-wrap: anywhere;
    color: #394b66;
  }
  .overview-heading {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 14px 16px 4px;
    font-size: 12px;
    font-weight: 600;
  }
  .overview-details {
    margin: 4px 16px;
    font-size: 11px;
  }
  .overview-details summary {
    cursor: pointer;
    padding: 6px 0;
  }
  .result-table th[scope='row'] {
    text-align: left;
    font-weight: 500;
  }
  .result-table td {
    white-space: normal;
  }
  .numeric {
    text-align: right;
  }
</style>
