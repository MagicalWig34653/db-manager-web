<script lang="ts">
  import {
    ArrowRight,
    ArrowUpRight,
    Check,
    CheckCheck,
    ChevronDown,
    ChevronRight,
    CircleHelp,
    Clock3,
    Code2,
    Database,
    FileCode2,
    Folder,
    KeyRound,
    LoaderCircle,
    Menu,
    Play,
    Plus,
    RefreshCw,
    Search,
    ShieldCheck,
    Square,
    Table2,
    Trash2,
    TriangleAlert,
    X,
  } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Badge } from '$lib/components/ui/badge';
  import * as Dialog from '$lib/components/ui/dialog';
  import ConnectionEditor from '$lib/components/ConnectionEditor.svelte';
  import ResultTable from '$lib/components/ResultTable.svelte';
  import SourceInformation from '$lib/components/SourceInformation.svelte';
  import {
    selectObject,
    type CatalogObject,
    type ConnectionDraft,
    type Execution,
    type Driver,
  } from '$lib/workbench';
  import { gateway } from '$lib/gateway';
  import { onDestroy } from 'svelte';

  let connection = $state<ConnectionDraft | null>(null);
  let objects = $state<CatalogObject[]>([]);
  let objectSearch = $state('');
  let sql = $state('');
  let editor = $state<HTMLTextAreaElement>();
  let connectionOpen = $state(false);
  let accessOpen = $state(false);
  let backendToken = $state('');
  let tokenDraft = $state('');
  let connectionBusy = $state(false);
  let availableDrivers = $state<Driver[] | undefined>();
  let connectionMessage = $state('');
  let catalogBusy = $state(false);
  let catalogError = $state('');
  let running = $state(false);
  let error = $state('');
  let cancelled = $state(false);
  let execution = $state<Execution | null>(null);
  let activeResult = $state(0);
  let rowLimit = $state(100);
  let timeoutMs = $state(10000);
  let sidebarOpen = $state(false);
  let sessionVersion = $state(0);
  let controller: AbortController | undefined;
  let sessionController = new AbortController();
  const driverNames = { sqlite: 'SQLite', mysql: 'MySQL / MariaDB', postgresql: 'PostgreSQL' };
  const filteredObjects = $derived(
    objects.filter((object) =>
      `${object.schema ?? ''}.${object.name}`.toLowerCase().includes(objectSearch.toLowerCase()),
    ),
  );
  const lineCount = $derived(Math.min(Math.max(sql.split('\n').length, 10), 10000));
  const currentResult = $derived(execution?.results[activeResult]);

  async function openConnection() {
    connectionMessage = '';
    availableDrivers = undefined;
    connectionOpen = true;
    const version = sessionVersion;
    try {
      const drivers = await gateway.capabilities(backendToken, sessionController.signal);
      if (version === sessionVersion) availableDrivers = drivers;
    } catch (cause) {
      if (version === sessionVersion)
        connectionMessage =
          cause instanceof Error ? cause.message : 'Das Backend ist nicht erreichbar.';
    }
  }
  async function testConnection(draft: ConnectionDraft) {
    const version = sessionVersion;
    connectionBusy = true;
    connectionMessage = '';
    try {
      const message = await gateway.test(draft, backendToken, sessionController.signal);
      if (version === sessionVersion) connectionMessage = message;
    } catch (cause) {
      if (version === sessionVersion)
        connectionMessage =
          cause instanceof Error ? cause.message : 'Die Verbindung konnte nicht geprüft werden.';
    } finally {
      if (version === sessionVersion) connectionBusy = false;
    }
  }
  async function connect(draft: ConnectionDraft) {
    const version = sessionVersion;
    connectionBusy = true;
    connectionMessage = '';
    try {
      await gateway.test(draft, backendToken, sessionController.signal);
      if (version !== sessionVersion) return;
      connection = draft;
      execution = null;
      error = '';
      cancelled = false;
      objects = [];
      connectionOpen = false;
      await loadCatalog();
      editor?.focus();
    } catch (cause) {
      if (version === sessionVersion)
        connectionMessage =
          cause instanceof Error
            ? cause.message
            : 'Die Verbindung konnte nicht hergestellt werden.';
    } finally {
      if (version === sessionVersion) connectionBusy = false;
    }
  }
  async function loadCatalog() {
    if (!connection) return;
    const version = sessionVersion;
    const sourceConnection = connection;
    catalogBusy = true;
    catalogError = '';
    try {
      const loaded = await gateway.catalog(connection, backendToken, sessionController.signal);
      if (version === sessionVersion && connection === sourceConnection) objects = loaded;
    } catch (cause) {
      if (version === sessionVersion && connection === sourceConnection)
        catalogError =
          cause instanceof Error ? cause.message : 'Die Objekte konnten nicht geladen werden.';
    } finally {
      if (version === sessionVersion && connection === sourceConnection) catalogBusy = false;
    }
  }
  function openObject(object: CatalogObject) {
    if (!connection) return;
    sql = selectObject(object, connection.driver);
    sidebarOpen = false;
    editor?.focus();
  }
  async function execute() {
    if (!connection || !sql.trim() || running || connectionBusy) return;
    const version = sessionVersion;
    const requestController = new AbortController();
    controller = requestController;
    running = true;
    error = '';
    cancelled = false;
    execution = null;
    activeResult = 0;
    try {
      const result = await gateway.execute(
        connection,
        backendToken,
        sql,
        { maxRows: rowLimit, timeoutMs },
        requestController.signal,
      );
      if (version === sessionVersion) execution = result;
    } catch (cause) {
      if (version !== sessionVersion) return;
      if (requestController.signal.aborted) cancelled = true;
      else
        error =
          cause instanceof Error ? cause.message : 'Die Abfrage konnte nicht ausgeführt werden.';
    } finally {
      if (version === sessionVersion) running = false;
    }
  }
  function cancelQuery() {
    controller?.abort();
  }
  function clearSession() {
    sessionVersion++;
    sessionController.abort();
    sessionController = new AbortController();
    controller?.abort();
    controller = undefined;
    connection = null;
    backendToken = '';
    tokenDraft = '';
    objects = [];
    sql = '';
    execution = null;
    error = '';
    cancelled = false;
    catalogError = '';
    objectSearch = '';
    connectionMessage = '';
    activeResult = 0;
    accessOpen = false;
    connectionOpen = false;
    running = false;
    connectionBusy = false;
    catalogBusy = false;
    availableDrivers = undefined;
  }
  function applyToken() {
    const nextToken = tokenDraft;
    if (nextToken !== backendToken) {
      clearSession();
      backendToken = nextToken;
    } else {
      tokenDraft = '';
      accessOpen = false;
    }
  }
  function handleKey(event: KeyboardEvent) {
    if (
      event.key === 'Enter' &&
      (event.metaKey || event.ctrlKey) &&
      !connectionOpen &&
      !accessOpen
    ) {
      event.preventDefault();
      void execute();
    }
    if (event.key === 'Escape' && running) {
      event.preventDefault();
      cancelQuery();
    }
    if (event.key === 'k' && (event.metaKey || event.ctrlKey) && !connectionOpen && !accessOpen) {
      event.preventDefault();
      editor?.focus();
    }
  }
  function editorKey(event: KeyboardEvent) {
    if (event.key === 'Tab' && !event.shiftKey && editor) {
      event.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      sql = sql.slice(0, start) + '  ' + sql.slice(end);
      requestAnimationFrame(() => {
        if (editor) editor.selectionStart = editor.selectionEnd = start + 2;
      });
    }
  }
  onDestroy(() => {
    sessionController.abort();
    controller?.abort();
  });
</script>

<svelte:window onkeydown={handleKey} />
<a class="skip-link" href="#sql-editor">Zum SQL-Editor</a>
<div class="workbench">
  <aside class:mobile-open={sidebarOpen} aria-label="Datenbanknavigation">
    <div class="brand">
      <div class="brand-icon"><Database size={21} strokeWidth={1.8} /></div>
      <div><strong>DB Manager</strong><small>Dein Datenbank-Arbeitsplatz</small></div>
      <Button
        class="sidebar-close"
        variant="ghost"
        size="icon"
        aria-label="Navigation schließen"
        onclick={() => (sidebarOpen = false)}><X /></Button
      >
    </div>
    <div class="sidebar-content">
      <div class="section-label">
        VERBINDUNG <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Verbindung hinzufügen"
          disabled={running}
          onclick={openConnection}><Plus /></Button
        >
      </div>
      {#if connection}
        <button class="connection-card" disabled={running} onclick={openConnection}
          ><span class="connection-glyph"><Database size={17} /></span><span
            ><strong>{connection.name || connection.database}</strong><small
              >{driverNames[connection.driver]}</small
            ></span
          ><ChevronDown size={15} /></button
        >
      {:else}
        <button class="add-connection" onclick={openConnection}
          ><Plus size={17} />Verbindung hinzufügen</button
        >
      {/if}
      <div class="sidebar-divider"></div>
      <div class="section-label">
        OBJEKTE <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Objekte aktualisieren"
          disabled={!connection || catalogBusy || running}
          onclick={loadCatalog}><RefreshCw class={catalogBusy ? 'animate-spin' : ''} /></Button
        >
      </div>
      {#if connection}
        <div class="search-field">
          <Search size={15} /><input
            aria-label="Objekte filtern"
            placeholder="Objekte filtern …"
            bind:value={objectSearch}
          />
        </div>
        <div class="database-label">
          <ChevronDown size={14} /><Database size={15} /><span>{connection.database}</span>
        </div>
        <div class="catalog-list" aria-busy={catalogBusy}>
          {#if catalogError}<p class="catalog-message error-text" role="alert">{catalogError}</p>
          {:else if catalogBusy}<p class="catalog-message">Objekte werden geladen …</p>
          {:else if filteredObjects.length === 0}<p class="catalog-message">
              {objectSearch ? 'Keine passenden Objekte.' : 'Keine Tabellen oder Views vorhanden.'}
            </p>
          {:else}{#each filteredObjects as object}<button
                class="object-button"
                disabled={running}
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
      aria-label="Navigation schließen"
      onclick={() => (sidebarOpen = false)}
    ></button>{/if}
  <div class="main-shell">
    <header class="topbar">
      <div class="breadcrumbs">
        <Button
          class="mobile-menu"
          variant="ghost"
          size="icon"
          aria-label="Navigation öffnen"
          onclick={() => (sidebarOpen = true)}><Menu /></Button
        ><Database size={15} /><span>{connection?.name || 'Arbeitsplatz'}</span><ChevronRight
          size={13}
        /><strong>SQL-Arbeitsbereich</strong>
      </div>
      <Button
        variant="outline"
        size="sm"
        onclick={() => {
          tokenDraft = backendToken;
          accessOpen = true;
        }}
        ><KeyRound />Backend-Zugang{#if backendToken}<span
            class="access-dot"
            aria-label="Token hinterlegt"
          ></span>{/if}</Button
      >
    </header>
    <main>
      <div class="page-heading">
        <div>
          <p class="eyebrow">DEINE DATEN. DEIN ARBEITSBEREICH.</p>
          <h1>SQL-Arbeitsbereich</h1>
          <p>Abfragen schreiben. Ergebnisse verstehen.</p>
        </div>
        <div class="connection-status" class:connected={!!connection}>
          <span></span>{connection ? 'Verbunden' : 'Nicht verbunden'}
        </div>
      </div>
      {#if !connection}<div class="onboarding">
          <div class="onboarding-icon"><Database size={22} /></div>
          <div>
            <strong>Beginne mit einer Verbindung</strong>
            <p>Verbinde eine Datenbank, um ihre Objekte zu erkunden und SQL auszuführen.</p>
          </div>
          <Button variant="outline" onclick={openConnection}
            >Verbindung hinzufügen <ArrowUpRight /></Button
          >
        </div>{/if}
      <section class="editor-panel" aria-label="SQL-Abfrage">
        <div class="panel-heading">
          <div class="query-tab">
            <FileCode2 size={17} /><strong>Abfrage 1</strong><Badge variant="secondary">SQL</Badge>
          </div>
          <span class="editor-hint"><span>Editor fokussieren</span><kbd>⌘ / Strg K</kbd></span>
        </div>
        <div class="editor-surface">
          <div class="line-numbers" aria-hidden="true">
            {#each Array.from({ length: lineCount }, (_, index) => index + 1) as line}<span
                >{line}</span
              >{/each}
          </div>
          <textarea
            id="sql-editor"
            aria-label="SQL-Abfrage"
            bind:this={editor}
            bind:value={sql}
            onkeydown={editorKey}
            spellcheck={false}
            autocomplete="off"
            autocapitalize="off"
            maxlength={1000000}
            placeholder="-- Schreibe hier deine SQL-Abfrage.&#10;-- Ausgeführt wird erst mit „Ausführen“ oder ⌘ / Strg + Enter."
            disabled={running}></textarea>
        </div>
        <div class="editor-toolbar">
          <div class="execution-actions">
            <Button
              class="run-button"
              aria-label="Abfrage ausführen"
              aria-keyshortcuts="Control+Enter Meta+Enter"
              onclick={execute}
              disabled={!connection || !sql.trim() || running || connectionBusy}
              >{#if running}<LoaderCircle class="animate-spin" />Wird ausgeführt{:else}<Play
                  size={15}
                  fill="currentColor"
                />Ausführen{/if}<kbd>⌘ ↵</kbd></Button
            >{#if running}<Button variant="outline" onclick={cancelQuery}
                ><Square size={13} />Abbrechen</Button
              >{/if}
          </div>
          <div class="execution-options">
            <label for="row-limit">Zeilenlimit</label><select
              id="row-limit"
              bind:value={rowLimit}
              disabled={running}
              ><option value={100}>100</option><option value={500}>500</option><option value={1000}
                >1.000</option
              ></select
            ><span class="toolbar-divider"></span><Clock3 size={14} /><select
              aria-label="Zeitlimit"
              bind:value={timeoutMs}
              disabled={running}
              ><option value={10000}>10 Sek.</option><option value={30000}>30 Sek.</option><option
                value={60000}>60 Sek.</option
              ></select
            >
          </div>
        </div>
      </section>
      <section class="results-panel" aria-label="Abfrageergebnisse" aria-busy={running}>
        <div class="panel-heading">
          <div class="result-title">
            <Table2 size={17} /><strong>Ergebnisse</strong>{#if currentResult}<Badge
                variant="secondary"
                >{currentResult.rows.length}
                {currentResult.rows.length === 1 ? 'Zeile' : 'Zeilen'}</Badge
              >{/if}
          </div>
          {#if execution}<span class="execution-time"
              ><CheckCheck size={15} />{execution.elapsedMs.toLocaleString('de-DE')} ms</span
            >{/if}
        </div>
        {#if error}<div class="feedback error-feedback" role="alert">
            <TriangleAlert size={21} />
            <div>
              <strong>Abfrage fehlgeschlagen</strong>
              <p>{error}</p>
            </div>
          </div>
        {:else if cancelled}<div class="feedback warning-feedback" role="status">
            <Square size={18} />
            <div>
              <strong>Abbruch angefordert</strong>
              <p>
                Der Serverstatus muss geprüft werden. Bereits ausgeführte Änderungen werden durch
                einen Abbruch nicht rückgängig gemacht.
              </p>
            </div>
          </div>
        {:else if running}<div class="results-empty" role="status">
            <div class="empty-icon running-icon">
              <LoaderCircle size={25} class="animate-spin" />
            </div>
            <h2>Abfrage wird ausgeführt</h2>
            <p>Ergebnisse werden geladen. Mit Escape kannst du abbrechen.</p>
          </div>
        {:else if execution}
          {#if execution.results.length > 1}<div
              class="result-tabs"
              role="tablist"
              aria-label="Ergebnissätze"
            >
              {#each execution.results as result, index}<button
                  role="tab"
                  aria-selected={activeResult === index}
                  onclick={() => (activeResult = index)}
                  >Ergebnis {index + 1}<span>{result.rows.length}</span></button
                >{/each}
            </div>{/if}
          {#if currentResult}<ResultTable result={currentResult} />{#if currentResult.truncated}<div
                class="limit-note"
                role="status"
              >
                <TriangleAlert size={16} /><span
                  >Ergebnis begrenzt. Es werden höchstens {rowLimit.toLocaleString('de-DE')} Zeilen angezeigt.
                  Nicht alle Datensätze sind enthalten.</span
                >
              </div>{/if}{:else}<div class="feedback">
              <Check size={20} />Anweisung ohne Ergebnissatz abgeschlossen.
            </div>{/if}
          {#each execution.warnings as warning}<div class="limit-note" role="status">
              <TriangleAlert size={16} />{warning}
            </div>{/each}
        {:else}<div class="results-empty">
            <div class="empty-icon"><Code2 size={27} strokeWidth={1.4} /></div>
            <h2>Platz für deine Ergebnisse</h2>
            <p>
              Führe eine Abfrage aus, um Daten, Spalten und<br class="desktop-break" /> Rückmeldungen
              hier zu sehen.
            </p>
            <span class="empty-shortcut"
              ><kbd>⌘ / Strg</kbd><span>+</span><kbd>Enter</kbd><span>zum Ausführen</span></span
            >
          </div>{/if}
        <div class="results-footer">
          <span
            ><span class="footer-dot"></span>{execution
              ? 'Werte werden ohne numerische Rundung angezeigt'
              : 'Bereit für deine erste Abfrage'}</span
          ><span>{rowLimit.toLocaleString('de-DE')} Zeilen max.</span>
        </div>
      </section>
      <footer class="workspace-footer">
        <span
          ><ShieldCheck size={14} />Zugangsdaten und Abfragen werden hier nicht dauerhaft
          gespeichert.</span
        ><SourceInformation /><span
          ><CircleHelp size={14} />⌘ / Strg + Enter ausführen · Escape abbrechen</span
        >
      </footer>
    </main>
  </div>
</div>
{#key sessionVersion}<ConnectionEditor
    bind:open={connectionOpen}
    busy={connectionBusy}
    message={connectionMessage}
    {availableDrivers}
    onconnect={connect}
    ontest={testConnection}
  />{/key}
<Dialog.Root bind:open={accessOpen}>
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
        applyToken();
      }}
    >
      <div class="form-field">
        <label for="backend-token">Zugriffstoken</label><Input
          id="backend-token"
          type="password"
          bind:value={tokenDraft}
          autocomplete="new-password"
          placeholder="Token eingeben"
        />
      </div>
      <div class="dialog-actions">
        <Button variant="ghost" type="button" onclick={clearSession}
          ><Trash2 />Sitzung leeren</Button
        ><Button type="submit">Übernehmen <ArrowRight /></Button>
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>
