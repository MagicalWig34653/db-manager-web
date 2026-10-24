<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import {
    ArrowRight,
    ArrowUpRight,
    ChevronDown,
    ChevronRight,
    CircleHelp,
    Database,
    Folder,
    KeyRound,
    Menu,
    Plus,
    RefreshCw,
    Search,
    Server,
    ShieldCheck,
    Table2,
    Trash2,
    TriangleAlert,
    X,
  } from '@lucide/svelte';
  import { onDestroy, tick, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Dialog from '$lib/components/ui/dialog';
  import ConnectionEditor from '$lib/components/ConnectionEditor.svelte';
  import SourceInformation from '$lib/components/SourceInformation.svelte';
  import CapabilityNotice from '$lib/components/shared/CapabilityNotice.svelte';
  import { featuresFor, findTab } from '$lib/features';
  import { t } from '$lib/i18n';
  import type { CatalogObject } from '$lib/workbench';
  import { setShellContext } from './context';
  import { formatRoute, parseHash, type Route } from './router';
  import { Session } from './session.svelte';
  import { dispatch, type Shortcut } from './shortcuts';
  import { SqlRunner } from './sql.svelte';

  let route = $state<Route>(parseHash(window.location.hash));
  let sidebarOpen = $state(false);
  const driverNames = { sqlite: 'SQLite', mysql: 'MySQL / MariaDB', postgresql: 'PostgreSQL' };

  function navigate(next: Route) {
    const hash = formatRoute(next);
    route = next;
    if (window.location.hash !== hash) window.location.hash = hash;
  }
  function sqlRoute(): Route {
    const database = session.connection?.database;
    return database ? { kind: 'database', database, tab: 'sql' } : { kind: 'home' };
  }
  const sql = new SqlRunner();
  const session = new Session({
    onConnected(draft) {
      sql.clearResults();
      const keep =
        (route.kind === 'database' || route.kind === 'table') && route.database === draft.database;
      if (!keep) navigate({ kind: 'database', database: draft.database, tab: 'sql' });
    },
    onCatalogSettled() {
      if (isSqlView) sql.focus();
    },
    onCleared() {
      sql.reset();
      navigate({ kind: 'home' });
    },
  });
  setShellContext({ session, sql });

  const sameTarget = (object: CatalogObject, target: Route) =>
    target.kind === 'table' &&
    object.name === target.table &&
    (object.schema ?? undefined) === target.schema;
  const databaseMatches = $derived(
    route.kind === 'home' ||
      route.kind === 'server' ||
      (!!session.connection && session.connection.database === route.database),
  );
  const isSqlView = $derived(
    route.kind === 'home' || (route.kind === 'database' && route.tab === 'sql'),
  );
  const isTableView = $derived(route.kind === 'table');
  const heading = $derived(
    route.kind === 'server'
      ? t('shell.serverOverview')
      : isTableView
        ? t('shell.tableView')
        : t('shell.sqlWorkspace'),
  );
  const tableTarget = $derived(
    session.selectedObject && route.kind === 'table' && sameTarget(session.selectedObject, route)
      ? session.selectedObject
      : null,
  );
  const extraDatabaseTabs = $derived(
    featuresFor('database-tab', session.capabilities).filter((e) => e.feature.tab !== 'sql'),
  );
  const extraTableTabs = $derived(
    featuresFor('table-tab', session.capabilities).filter((e) => e.feature.tab !== 'daten'),
  );

  // Resolves the table of a table route once the catalog is available; never from the URL alone.
  $effect(() => {
    const target = route;
    const connection = session.connection;
    const objects = session.objects;
    untrack(() => {
      const current = session.selectedObject;
      if (target.kind !== 'table' || !connection || connection.database !== target.database) {
        if (current) {
          session.separateWriteContext();
          session.selectedObject = null;
        }
        return;
      }
      if (current && sameTarget(current, target)) return;
      const found = objects.find((object) => sameTarget(object, target)) ?? null;
      if (current) session.separateWriteContext();
      session.selectedObject = found;
    });
  });

  function openObject(object: CatalogObject) {
    const connection = session.connection;
    if (!connection) return;
    navigate({
      kind: 'table',
      database: connection.database,
      ...(object.schema ? { schema: object.schema } : {}),
      table: object.name,
      tab: 'daten',
    });
    sidebarOpen = false;
  }
  function openTableTab() {
    if (session.selectedObject && session.connection) openObject(session.selectedObject);
  }
  function skipToWorkspace(event: MouseEvent) {
    event.preventDefault();
    const target = document.getElementById(isSqlView ? 'sql-editor' : 'table-workspace');
    (target ?? document.getElementById('main-content'))?.focus();
  }
  function focusEditorLater() {
    navigate(sqlRoute());
    void tick().then(() => sql.focus());
  }
  const dialogsClosed = () => !session.connectionOpen && !session.accessOpen;
  const shortcuts: Shortcut[] = [
    {
      id: 'run-query',
      key: 'Enter',
      mod: true,
      when: () => isSqlView && dialogsClosed(),
      run: () => void sql.execute(session),
    },
    { id: 'cancel-query', key: 'Escape', when: () => sql.running, run: () => sql.cancel() },
    {
      id: 'focus-editor',
      key: 'k',
      mod: true,
      when: dialogsClosed,
      run: focusEditorLater,
    },
  ];
  onDestroy(() => {
    session.destroy();
    sql.cancel();
  });
</script>

<svelte:window
  onhashchange={() => (route = parseHash(window.location.hash))}
  onkeydown={(event) => dispatch(event, shortcuts)}
  onbeforeunload={(event) => {
    if (session.writeInFlight) {
      event.preventDefault();
      event.returnValue = '';
    }
  }}
/>
<a class="skip-link" href="#main-content" onclick={skipToWorkspace}>{t('shell.skipLink')}</a>
<div class="workbench">
  <aside class:mobile-open={sidebarOpen} aria-label={t('shell.navigationLabel')}>
    <div class="brand">
      <div class="brand-icon"><Database size={21} strokeWidth={1.8} /></div>
      <div><strong>DB Manager</strong><small>Dein Datenbank-Arbeitsplatz</small></div>
      <Button
        class="sidebar-close"
        variant="ghost"
        size="icon"
        aria-label={t('shell.navigationClose')}
        onclick={() => (sidebarOpen = false)}><X /></Button
      >
    </div>
    <div class="sidebar-content">
      <div class="section-label">
        {t('nav.sectionConnection')}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Verbindung hinzufügen"
          disabled={sql.running}
          onclick={() => session.openConnection()}><Plus /></Button
        >
      </div>
      {#if session.connection}
        <button
          class="connection-card"
          disabled={sql.running}
          onclick={() => session.openConnection()}
          ><span class="connection-glyph"><Database size={17} /></span><span
            ><strong>{session.connection.name || session.connection.database}</strong><small
              >{driverNames[session.connection.driver]}</small
            ></span
          ><ChevronDown size={15} /></button
        >
      {:else}
        <button class="add-connection" onclick={() => session.openConnection()}
          ><Plus size={17} />Verbindung hinzufügen</button
        >
      {/if}
      <div class="sidebar-divider"></div>
      <div class="section-label">
        {t('nav.sectionObjects')}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Objekte aktualisieren"
          disabled={!session.connection || session.catalogBusy || sql.running}
          onclick={() => session.loadCatalog()}
          ><RefreshCw class={session.catalogBusy ? 'animate-spin' : ''} /></Button
        >
      </div>
      {#if session.connection}
        <a
          class="database-label"
          href={formatRoute({ kind: 'server', tab: 'uebersicht' })}
          aria-current={route.kind === 'server' ? 'page' : undefined}
          ><Server size={14} /><span>{t('shell.server')}</span></a
        >
        <div class="search-field">
          <Search size={15} /><input
            aria-label="Objekte filtern"
            placeholder="Objekte filtern …"
            bind:value={session.objectSearch}
          />
        </div>
        <a
          class="database-label"
          href={formatRoute(sqlRoute())}
          aria-current={route.kind === 'database' ? 'page' : undefined}
          ><ChevronDown size={14} /><Database size={15} /><span>{session.connection.database}</span
          ></a
        >
        <div class="catalog-list" aria-busy={session.catalogBusy}>
          {#if session.catalogError}<p class="catalog-message error-text" role="alert">
              {session.catalogError}
            </p>
          {:else if session.catalogBusy}<p class="catalog-message">Objekte werden geladen …</p>
          {:else if session.filteredObjects.length === 0}<p class="catalog-message">
              {session.objectSearch
                ? 'Keine passenden Objekte.'
                : 'Keine Tabellen oder Views vorhanden.'}
            </p>
          {:else}{#each session.filteredObjects as object}<button
                class="object-button"
                disabled={sql.running}
                onclick={() => openObject(object)}
                ><Table2 size={15} /><span
                  >{object.schema ? `${object.schema}.` : ''}{object.name}</span
                >{#if object.type === 'view'}<small>View</small>{/if}</button
              >{/each}{/if}
        </div>
      {:else}
        <div class="sidebar-empty">
          <Folder size={25} strokeWidth={1.3} />
          <p>Deine Tabellen und Views<br />erscheinen nach dem Verbinden.</p>
        </div>
      {/if}
    </div>
    <div class="sidebar-footer">
      <ShieldCheck size={16} /><span
        >Nur in dieser Sitzung<small>Keine gespeicherten Zugangsdaten</small></span
      >
    </div>
  </aside>
  {#if sidebarOpen}<button
      class="sidebar-scrim"
      aria-label={t('shell.navigationClose')}
      onclick={() => (sidebarOpen = false)}
    ></button>{/if}
  <div class="main-shell">
    <header class="topbar">
      <div class="breadcrumbs">
        <Button
          class="mobile-menu"
          variant="ghost"
          size="icon"
          aria-label={t('shell.navigationOpen')}
          onclick={() => (sidebarOpen = true)}><Menu /></Button
        ><Database size={15} /><span>{session.connection?.name || t('shell.workspace')}</span
        ><ChevronRight size={13} /><strong>{heading}</strong>
      </div>
      <Button
        variant="outline"
        size="sm"
        onclick={() => {
          session.tokenDraft = session.backendToken;
          session.accessOpen = true;
        }}
        ><KeyRound />Backend-Zugang{#if session.backendToken}<span
            class="access-dot"
            aria-label="Token hinterlegt"
          ></span>{/if}</Button
      >
    </header>
    <main id="main-content" tabindex="-1">
      {#if session.writeNotice}<div class="global-write-notice" role="alert">
          <TriangleAlert size={20} /><span
            >Der Ausgang eines gesendeten Schreibvorgangs ist unbekannt. Er kann bereits übernommen
            worden sein. Nicht erneut senden; prüfe zuerst den aktuellen Datenbankstand.</span
          ><Button variant="outline" size="sm" onclick={() => (session.writeNotice = false)}
            >Hinweis schließen</Button
          >
        </div>{/if}
      <div class="page-heading">
        <div>
          <p class="eyebrow">DEINE DATEN. DEIN ARBEITSBEREICH.</p>
          <h1>{heading}</h1>
          <p>
            {route.kind === 'server'
              ? 'Verbindung und Server im Überblick.'
              : isTableView
                ? 'Daten erkunden. Struktur verstehen.'
                : 'Abfragen schreiben. Ergebnisse verstehen.'}
          </p>
        </div>
        <div class="connection-status" class:connected={!!session.connection}>
          <span></span>{session.connection ? t('shell.connected') : t('shell.notConnected')}
        </div>
      </div>
      {#if !session.connection}<div class="onboarding">
          <div class="onboarding-icon"><Database size={22} /></div>
          <div>
            <strong>Beginne mit einer Verbindung</strong>
            <p>Verbinde eine Datenbank, um ihre Objekte zu erkunden und SQL auszuführen.</p>
          </div>
          <Button variant="outline" onclick={() => session.openConnection()}
            >Verbindung hinzufügen <ArrowUpRight /></Button
          >
        </div>{/if}
      {#if route.kind !== 'server'}
        <nav class="workspace-tabs" aria-label={t('shell.tabsLabel')}>
          <button aria-pressed={isSqlView} onclick={() => navigate(sqlRoute())}
            >{t('shell.tabSql')}</button
          ><button
            aria-pressed={isTableView}
            disabled={!session.selectedObject}
            onclick={openTableTab}>{t('shell.tabTable')}</button
          >{#each extraDatabaseTabs as { feature, available } (feature.id)}<button
              aria-pressed={route.kind === 'database' && route.tab === feature.tab}
              disabled={!session.connection}
              onclick={() =>
                session.connection &&
                navigate({
                  kind: 'database',
                  database: session.connection.database,
                  tab: feature.tab ?? 'sql',
                })}
              aria-disabled={!available}>{t(feature.titleKey)}</button
            >{/each}
        </nav>
      {/if}
      {#if route.kind === 'table' && extraTableTabs.length > 0}
        <nav class="workspace-tabs" aria-label="Tabellenreiter">
          <button aria-pressed={route.tab === 'daten'} onclick={openTableTab}
            >{t('shell.tabTable')}</button
          >{#each extraTableTabs as { feature } (feature.id)}<button
              aria-pressed={route.tab === feature.tab}
              onclick={() =>
                route.kind === 'table' && navigate({ ...route, tab: feature.tab ?? 'daten' })}
              >{t(feature.titleKey)}</button
            >{/each}
        </nav>
      {/if}
      {#if route.kind === 'server'}
        {@const entry = findTab('server-tab', route.tab, session.capabilities)}
        {#if !entry}
          <CapabilityNotice title={t('shell.invalidLinkTitle')} reason={t('shell.unknownTab')} />
        {:else if !entry.available}
          <CapabilityNotice />
        {:else}
          {@const Feature = entry.feature.component}
          <Feature
            connection={session.connection}
            token={session.backendToken}
            tab={route.tab}
            onsql={() => navigate(sqlRoute())}
            onwritephase={() => {}}
          />
        {/if}
      {:else if route.kind === 'table'}
        {@const entry = findTab('table-tab', route.tab, session.capabilities)}
        {#if !entry}
          <CapabilityNotice title={t('shell.invalidLinkTitle')} reason={t('shell.unknownTab')} />
        {:else if !session.connection || !databaseMatches}
          <CapabilityNotice
            title={t('shell.invalidLinkTitle')}
            reason={t('shell.noConnectionForDatabase', { database: route.database })}
          />
        {:else if !entry.available}
          <CapabilityNotice />
        {:else if tableTarget}
          {@const Feature = entry.feature.component}
          <Feature
            connection={session.connection}
            token={session.backendToken}
            database={route.database}
            object={tableTarget}
            tab={route.tab}
            onsql={() => navigate(sqlRoute())}
            onwritephase={session.writeReceiver(tableTarget, session.sessionVersion)}
          />
        {:else}
          <p class="catalog-message" role="status">
            {session.catalogError
              ? session.catalogError
              : session.catalogLoaded
                ? t('shell.tableNotFound', { name: route.table })
                : t('shell.tableLoading')}
          </p>
        {/if}
      {:else}
        {@const tab = route.kind === 'database' ? route.tab : 'sql'}
        {@const entry = findTab('database-tab', tab, session.capabilities)}
        {#if !entry}
          <CapabilityNotice title={t('shell.invalidLinkTitle')} reason={t('shell.unknownTab')} />
        {:else if !!session.connection && !databaseMatches}
          <CapabilityNotice
            title={t('shell.invalidLinkTitle')}
            reason={t('shell.noConnectionForDatabase', {
              database: route.kind === 'database' ? route.database : '',
            })}
          />
        {:else if !entry.available}
          <CapabilityNotice />
        {:else}
          {@const Feature = entry.feature.component}
          <Feature
            connection={session.connection}
            token={session.backendToken}
            database={session.connection?.database}
            {tab}
            onsql={() => navigate(sqlRoute())}
            onwritephase={() => {}}
          />
        {/if}
      {/if}
      <footer class="workspace-footer">
        <span
          ><ShieldCheck size={14} />Zugangsdaten und Abfragen werden hier nicht dauerhaft
          gespeichert.</span
        ><SourceInformation /><span
          ><CircleHelp size={14} />{t('shortcuts.runQuery')} · {t('shortcuts.cancelQuery')}</span
        >
      </footer>
    </main>
  </div>
</div>
{#key session.sessionVersion}<ConnectionEditor
    bind:open={session.connectionOpen}
    busy={session.connectionBusy}
    message={session.connectionMessage}
    availableDrivers={session.availableDrivers}
    onconnect={(draft) => session.connect(draft)}
    ontest={(draft) => session.testConnection(draft)}
  />{/key}
<Dialog.Root bind:open={session.accessOpen}>
  <Dialog.Content class="sm:max-w-[480px] p-7">
    <Dialog.Header
      ><div class="dialog-mark"><KeyRound size={22} /></div>
      <Dialog.Title class="text-xl">Backend-Zugang</Dialog.Title><Dialog.Description
        >Gib den Zugriffstoken deiner Instanz ein. Er bleibt ausschließlich für diese Sitzung im
        Arbeitsspeicher.</Dialog.Description
      ></Dialog.Header
    >
    <form
      autocomplete="off"
      onsubmit={(event) => {
        event.preventDefault();
        session.applyToken();
      }}
    >
      <div class="form-field">
        <label for="backend-token">Zugriffstoken</label><Input
          id="backend-token"
          type="password"
          bind:value={session.tokenDraft}
          autocomplete="new-password"
          placeholder="Token eingeben"
        />
      </div>
      <div class="dialog-actions">
        <Button variant="ghost" type="button" onclick={() => session.clearSession()}
          ><Trash2 />Sitzung leeren</Button
        ><Button type="submit">Übernehmen <ArrowRight /></Button>
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>
