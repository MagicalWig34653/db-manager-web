// SPDX-License-Identifier: AGPL-3.0-only
// Independent review of the web wave: hostile backend/database text, plan-hash binding, replay, offline
// behaviour and backend 3a7e1f1 contract realities. F-1, F-2 (contract v23) and F-4 are fixed and run as normal tests.
import { test, expect, type Page } from '@playwright/test';
import { actions, type Schemas, type Action } from '../../src/lib/features/accounts/model';
import {
  capabilities as accountCaps,
  details,
  info,
  plan as accountPlan,
  result as accountResult,
} from '../../src/lib/features/accounts/testing';
import {
  capabilities as programCaps,
  listing,
  program,
  plan as programPlan,
  result as programResult,
} from '../../src/lib/features/programs/testing';

// 35 characters: fits account names (max 63) and every other bounded identifier.
const XSS = '<img src=x onerror=window.__xss=1>';

async function baseRoutes(page: Page) {
  await page.route('**/api/v1/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('/capabilities'))
      return route.fulfill({
        json: {
          contract_version: '0.1.0',
          drivers: ['sqlite', 'mysql', 'postgres'],
          credential_storage: false,
          max_rows: 10000,
          max_timeout_ms: 60000,
        },
      });
    if (url.endsWith('/connections/test')) return route.fulfill({ json: { status: 'ok' } });
    if (url.endsWith('/catalog')) return route.fulfill({ json: { tables: [] } });
    return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: '' } } });
  });
}
async function noInjection(page: Page) {
  expect(
    await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
  ).toBeUndefined();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(page.locator('main script')).toHaveCount(0);
}

// ---------------------------------------------------------------- accounts
async function accountsBackend(
  page: Page,
  options: {
    hostile?: boolean;
    result?: unknown;
    action?: Action;
    html502?: boolean;
    listFails?: boolean;
  } = {},
) {
  const plans: Record<string, unknown>[] = [];
  const executes: Record<string, unknown>[] = [];
  await baseRoutes(page);
  await page.route('**/api/v15/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/capabilities')) return route.fulfill({ json: accountCaps() });
    if (url.endsWith('/access')) return route.fulfill({ json: { actions, notes: [] } });
    if (url.endsWith('/list')) {
      if (options.listFails) return route.abort('failed');
      const account = info();
      if (options.hostile) account.account = { name: XSS, host: XSS };
      return route.fulfill({ json: { accounts: [account], truncated: false } });
    }
    if (url.endsWith('/inspect')) {
      const data = details();
      if (options.hostile) {
        data.grants = data.grants.map((grant) => ({ ...grant, database: XSS }));
        data.notes = [XSS];
        data.roles = [{ name: XSS, host: XSS }];
      }
      return route.fulfill({ json: data });
    }
    const body = route.request().postDataJSON();
    const action = new URL(url).pathname.split('/').at(-2) as Action;
    if (url.endsWith('/plan')) {
      plans.push(body);
      const planned = accountPlan(action, { requires_secret: false, self: false });
      if (options.hostile) {
        planned.statements = [`DROP USER ${XSS}`];
        planned.warnings = [XSS];
        planned.affected_objects = [XSS];
        planned.confirmation = { ...planned.confirmation, target_name: XSS };
        planned.plan_sha256 = 'b'.repeat(64);
      }
      return route.fulfill({ json: planned });
    }
    executes.push(body);
    if (options.html502)
      return route.fulfill({
        status: 502,
        contentType: 'text/html',
        body: '<html>Bad Gateway</html>',
      });
    return route.fulfill({ json: options.result ?? accountResult() });
  });
  await page.goto('/#/server/benutzer');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByRole('button', { name: /MySQL \/ MariaDB/ }).click();
  await page.getByLabel('Host', { exact: true }).fill('fixture.invalid');
  await page.getByLabel('Benutzername', { exact: true }).fill('synthetic');
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    location.hash = '#/server/benutzer';
  });
  return { plans, executes };
}

test('accounts: hostile account, grant, role, note and plan text stays inert text; exact hash and typed name are sent', async ({
  page,
}) => {
  const mock = await accountsBackend(page, { hostile: true });
  await expect(page.getByTestId('account-list')).toBeVisible();
  await page.getByTestId('account-list').getByRole('button').first().click();
  await expect(page.getByTestId('grants-database')).toContainText('<img src=x');
  await page.getByLabel('Aktion', { exact: true }).selectOption('drop');
  await page.getByRole('button', { name: 'Plan anzeigen' }).click();
  await expect(page.getByLabel('Getippte Kontokennung')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Geplante SQL-Anweisungen' })).toContainText(
    '<img src=x',
  );
  await noInjection(page);
  const execute = page.getByRole('button', { name: 'Bestätigt ausführen' });
  await page.getByLabel('Ich habe den Plan und die Warnungen geprüft.').check();
  await page.getByLabel('Getippte Kontokennung').fill(XSS.slice(0, -1));
  await expect(execute).toBeDisabled();
  await page.getByLabel('Getippte Kontokennung').fill(XSS);
  await execute.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
    button.click();
  });
  await expect.poll(() => mock.executes.length).toBe(1);
  await page.waitForTimeout(300);
  expect(mock.executes).toHaveLength(1);
  expect(mock.executes[0]).toMatchObject({
    expected_plan_sha256: 'b'.repeat(64),
    confirm: { action: 'drop', target_name: XSS },
  });
  expect(mock.executes[0]).not.toHaveProperty('secret');
  expect(JSON.stringify(mock.plans)).not.toContain('secret');
  await noInjection(page);
});

test('accounts: list request lost (offline) shows an error and no stale table', async ({
  page,
}) => {
  await accountsBackend(page, { listFails: true });
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByTestId('account-list')).toHaveCount(0);
});

test('accounts: a proxy 502 page during execute is an unknown outcome without a retry path', async ({
  page,
}) => {
  const mock = await accountsBackend(page, { html502: true });
  await expect(page.getByTestId('account-list')).toBeVisible();
  await page.getByTestId('account-list').getByRole('button').first().click();
  await page.getByLabel('Aktion', { exact: true }).selectOption('lock');
  await page.getByRole('button', { name: 'Plan anzeigen' }).click();
  await page.getByLabel('Ich habe den Plan und die Warnungen geprüft.').check();
  await page.getByLabel('Getippte Kontokennung').fill('9:synthetic@%');
  await page.getByRole('button', { name: 'Bestätigt ausführen' }).click();
  // The same sentence is announced twice (error text and unknown notice): review finding F-9 (low).
  await expect(
    page
      .locator('p[role="alert"]')
      .filter({ hasText: /Nicht erneut senden/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bestätigt ausführen' })).toHaveCount(0);
  expect(mock.executes).toHaveLength(1);
});

// Backend 3a7e1f1 answered a PostgreSQL GRANT without effect with reason "grant_without_effect", which the v15 enum
// rejected (outcome shown as unknown). Contract v23 adds the reason; the web pins v23 and this runs as a normal test.
test('REVIEW F-2: a backend "rejected / grant_without_effect" answer is shown as rejected, not as unknown outcome', async ({
  page,
}) => {
  await accountsBackend(page, {
    result: {
      outcome: 'rejected',
      reason: 'grant_without_effect',
      message: 'Das Recht wurde nicht wirksam gewährt. Es wurde nichts geändert.',
      statements_executed: 0,
      atomic: true,
    } satisfies Schemas['AccountResult'] | Record<string, unknown>,
  });
  await expect(page.getByTestId('account-list')).toBeVisible();
  await page.getByTestId('account-list').getByRole('button').first().click();
  await page.getByLabel('Aktion', { exact: true }).selectOption('lock');
  await page.getByRole('button', { name: 'Plan anzeigen' }).click();
  await page.getByLabel('Ich habe den Plan und die Warnungen geprüft.').check();
  await page.getByLabel('Getippte Kontokennung').fill('9:synthetic@%');
  await page.getByRole('button', { name: 'Bestätigt ausführen' }).click();
  await expect(page.getByText('Abgewiesen.')).toBeVisible();
  await expect(page.getByText(/Ausgang ist unbekannt/)).toHaveCount(0);
});

// ---------------------------------------------------------------- programs
async function programsBackend(
  page: Page,
  options: { hostile?: boolean; result?: unknown; replace?: boolean } = {},
) {
  const writes: Record<string, unknown>[] = [];
  await baseRoutes(page);
  await page.route('**/api/v16/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/capabilities')) return route.fulfill({ json: programCaps() });
    if (path.endsWith('/list')) {
      const data = listing();
      if (options.hostile) data.objects[0].object.name = XSS;
      return route.fulfill({ json: data });
    }
    if (path.endsWith('/describe')) {
      const item = program() as ReturnType<typeof program> & Record<string, unknown>;
      if (options.hostile) {
        item.object = { ...item.object, name: XSS };
        item.definition = XSS;
        item.warnings = [XSS];
      }
      return route.fulfill({ json: { ...listing(), objects: [item] } });
    }
    if (path.endsWith('/plan')) {
      const body = route.request().postDataJSON();
      const planned = programPlan({
        action: body.action,
        object: body.object,
        statements: ['DROP VIEW x', 'CREATE VIEW x AS SELECT 1'],
        warnings: [options.hostile ? XSS : 'Bisherige Definition: CREATE VIEW x AS SELECT 0'],
        transactional: false,
        destructive: true,
        plan_sha256: 'c'.repeat(64),
      });
      return route.fulfill({ json: planned });
    }
    if (path.endsWith('/execute')) {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: options.result ?? programResult() });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: '' } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Arbeitsbereich' })
    .getByRole('button', { name: 'Programmobjekte' })
    .click();
  await expect(page.getByTestId('program-list')).toBeVisible();
  return writes;
}
async function replaceFlow(page: Page) {
  await page.getByTestId('program-list').getByRole('button').first().click();
  await expect(page.getByTestId('program-detail')).toBeVisible();
  await page.getByRole('button', { name: 'Ersetzen', exact: true }).click();
  await page.getByRole('checkbox', { name: /bewusst neu eingegeben/ }).check();
  await page.getByRole('button', { name: 'Plan anzeigen', exact: true }).click();
  await expect(page.getByTestId('program-plan')).toBeVisible();
}

test('programs: hostile object name, definition, warnings and plan text stay text; hash and name are sent once', async ({
  page,
}) => {
  const writes = await programsBackend(page, { hostile: true });
  await replaceFlow(page);
  await expect(page.getByTestId('program-detail')).toContainText('<img src=x');
  await expect(page.getByTestId('program-plan')).toContainText('<img src=x');
  await noInjection(page);
  await page.getByRole('checkbox', { name: /Exakte Anweisungen/ }).check();
  await page.getByRole('textbox', { name: /exakt eingeben/ }).fill(XSS);
  const run = page.getByRole('button', { name: 'Ausführen', exact: true });
  await run.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect.poll(() => writes.length).toBe(1);
  await page.waitForTimeout(300);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    expected_plan_sha256: 'c'.repeat(64),
    confirm: { action: 'replace', target_name: XSS },
  });
  await noInjection(page);
});

// Backend 3a7e1f1 (programs.go:415-491): MySQL replace = DROP+CREATE with automatic restore. A failed CREATE
// answers outcome=rejected, statements_executed=1 of 2, message "... automatisch wiederhergestellt (restored)".
test('REVIEW F-1: restored replace shows the backend message and no claim that nothing was restored', async ({
  page,
}) => {
  await programsBackend(page, {
    result: programResult({
      outcome: 'rejected',
      reason: 'database_error',
      message:
        'Die neue Definition wurde vom Server abgelehnt; die bisherige Definition wurde automatisch wiederhergestellt (restored).',
      statements_executed: 1,
      statements_total: 2,
      atomic: false,
    }),
  });
  await replaceFlow(page);
  await page.getByRole('checkbox', { name: /Exakte Anweisungen/ }).check();
  await page.getByRole('textbox', { name: /exakt eingeben/ }).fill(programPlan().object.name);
  await page.getByRole('button', { name: 'Ausführen', exact: true }).click();
  await expect(page.getByText(/automatisch wiederhergestellt/)).toBeVisible();
  await expect(page.getByText(/nicht wiederhergestellt/)).toHaveCount(0);
});

test('programs: restore_failed keeps old definition visible as text and signals unknown without retry', async ({
  page,
}) => {
  const writes = await programsBackend(page, {
    result: programResult({
      outcome: 'outcome_unknown',
      reason: undefined,
      message: `Wiederherstellung fehlgeschlagen (restore_failed). Bisherige Definition: ${XSS}`,
      statements_executed: 1,
      statements_total: 2,
      atomic: false,
    }),
  });
  await replaceFlow(page);
  await page.getByRole('checkbox', { name: /Exakte Anweisungen/ }).check();
  await page.getByRole('textbox', { name: /exakt eingeben/ }).fill(programPlan().object.name);
  await page.getByRole('button', { name: 'Ausführen', exact: true }).click();
  await expect(
    page.locator('p[role="alert"]').filter({ hasText: /Nicht erneut senden/ }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ausführen', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('previous-definition-result')).toBeVisible();
  await noInjection(page);
  expect(writes).toHaveLength(1);
});

test('programs: list fetch lost (offline) shows an error and offers reload', async ({ page }) => {
  await baseRoutes(page);
  await page.route('**/api/v16/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/capabilities')) return route.fulfill({ json: programCaps() });
    return route.abort('failed');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Arbeitsbereich' })
    .getByRole('button', { name: 'Programmobjekte' })
    .click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /neu laden/i })).toBeEnabled();
});

// The explicit SQL editor (/api/v1/query) can run DDL/DML and is counted in Session.writeCount (F-4).
test('REVIEW F-4: a running SQL editor statement warns on beforeunload like every other writer', async ({
  page,
}) => {
  await baseRoutes(page);
  await page.route('**/api/v1/query', () => new Promise(() => {}));
  await page.goto('/#/datenbank/sql');
  await page.getByRole('button', { name: 'Verbindung hinzufügen', exact: true }).first().click();
  await page.getByLabel('Datenbank', { exact: true }).fill('synthetic');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Verbunden', { exact: true })).toBeVisible();
  await page.locator('#sql-editor').fill('DROP TABLE orders');
  await page.getByRole('button', { name: 'Abfrage ausführen' }).click();
  await expect(page.getByRole('button', { name: 'Abbrechen' })).toBeVisible();
  const prevented = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
});
