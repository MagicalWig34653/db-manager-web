// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api';
import { emptyConnection } from '$lib/workbench';
import { accountsClient } from './client';
import { actions, type Action, type Schemas } from './model';
import { capabilities, info, details, plan, result, deferred, ref } from './testing';
import AccountsTab from './AccountsTab.svelte';
const base = { ...emptyConnection(), driver: 'mysql' as const, database: 'synthetic' };
function arrange() {
  vi.spyOn(accountsClient, 'capabilities').mockResolvedValue(capabilities());
  vi.spyOn(accountsClient, 'access').mockResolvedValue({ actions: [...actions], notes: [] });
  vi.spyOn(accountsClient, 'list').mockResolvedValue({ accounts: [info()], truncated: false });
  vi.spyOn(accountsClient, 'inspect').mockResolvedValue(details());
  const plans = vi.spyOn(accountsClient, 'plan').mockImplementation(async (action) => plan(action));
  const executes = vi
    .spyOn(accountsClient, 'execute')
    .mockImplementation(async (_a, _b, _t, dispatch) => {
      dispatch();
      return result();
    });
  return { plans, executes };
}
function mount(driver: 'mysql' | 'postgresql' | 'sqlite' = 'mysql') {
  const phases: string[] = [];
  const props = {
    connection: { ...base, driver },
    token: 'tok',
    tab: 'benutzer',
    onsql: () => {},
    onwritephase: (phase: string) => phases.push(phase),
  };
  return { ...render(AccountsTab, props), props, phases };
}
async function ready() {
  await screen.findByTestId('account-list');
}
async function select(action: Action) {
  await ready();
  await fireEvent.click(screen.getByRole('button', { name: /^synthetic$/ }));
  await fireEvent.change(screen.getByLabelText('Aktion'), { target: { value: action } });
}
async function confirm() {
  await fireEvent.click(screen.getByLabelText('Ich habe den Plan und die Warnungen geprüft.'));
  await fireEvent.input(screen.getByLabelText('Getippte Kontokennung'), {
    target: { value: '9:synthetic@%' },
  });
  await fireEvent.click(screen.getByLabelText(/Ich bestätige zusätzlich/));
}
afterEach(() => vi.restoreAllMocks());
describe('AccountsTab', () => {
  it('renders account facts, five scopes, roles and explicit coverage boundaries', async () => {
    arrange();
    mount();
    await select('grant');
    await screen.findByText('synthetic_role@%');
    const list = screen.getByTestId('account-list');
    expect(list).toHaveTextContent('synthetic_plugin');
    expect(list).toHaveTextContent('ANY');
    expect(list).toHaveTextContent('max_user_connections: 7');
    for (const scope of ['global', 'database', 'table', 'column', 'routine'])
      expect(screen.getByTestId(`grants-${scope}`)).toBeVisible();
    expect(screen.getByTestId('grants-column')).toHaveTextContent('note');
    expect(screen.getByTestId('grants-routine')).toHaveTextContent('123');
    expect(screen.getByText(/Effektive, geerbte/)).toBeVisible();
  });
  it('collects password only after planning and clears it synchronously when sending', async () => {
    const { plans, executes } = arrange();
    const { phases } = mount();
    await select('password');
    expect(screen.queryByLabelText('Neues Passwort')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
    const password = await screen.findByLabelText('Neues Passwort');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'off');
    await fireEvent.input(password, { target: { value: 'synthetic-secret' } });
    expect(screen.getByRole('button', { name: 'Bestätigt ausführen' })).toBeDisabled();
    await confirm();
    const pending = deferred<Schemas['AccountResult']>();
    let sent: Record<string, unknown> | undefined;
    executes.mockImplementation((_a, body, _t, dispatch) => {
      sent = structuredClone(body);
      dispatch();
      return pending.promise;
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Bestätigt ausführen' }));
    expect(password).toHaveValue('');
    expect(plans.mock.calls[0][1]).not.toHaveProperty('secret');
    expect(sent).toMatchObject({
      secret: 'synthetic-secret',
      confirm: { action: 'password', acknowledge_self: true },
    });
    expect(
      screen.getByRole('region', { name: 'Geplante SQL-Anweisungen' }).textContent,
    ).not.toContain('synthetic-secret');
    expect(phases).toEqual(['sending']);
    pending.resolve(result());
    await screen.findByText(/Diese Ausführung ist abgeschlossen/);
    expect(executes).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(['sending', 'settled']);
    expect(screen.queryByRole('button', { name: 'Bestätigt ausführen' })).toBeNull();
  });
  it('requires exact typed account identity and second confirmation before deleting', async () => {
    const { executes } = arrange();
    mount();
    await select('drop');
    await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
    await screen.findByLabelText('Getippte Kontokennung');
    await fireEvent.click(screen.getByLabelText('Ich habe den Plan und die Warnungen geprüft.'));
    await fireEvent.input(screen.getByLabelText('Getippte Kontokennung'), {
      target: { value: 'synthetic' },
    });
    await fireEvent.click(screen.getByLabelText(/Ich bestätige zusätzlich/));
    expect(screen.getByRole('button', { name: 'Bestätigt ausführen' })).toBeDisabled();
    expect(executes).not.toHaveBeenCalled();
    await fireEvent.input(screen.getByLabelText('Getippte Kontokennung'), {
      target: { value: '9:synthetic@%' },
    });
    expect(screen.getByRole('button', { name: 'Bestätigt ausführen' })).toBeEnabled();
  });
  it('explains SQLite honestly and sends no account read or write', async () => {
    arrange();
    mount('sqlite');
    await screen.findByTestId('accounts-unsupported');
    expect(accountsClient.list).not.toHaveBeenCalled();
    expect(accountsClient.access).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Plan anzeigen' })).toBeNull();
  });
  it('uses both capabilities and access restrictions with visible reasons', async () => {
    arrange();
    const caps = capabilities();
    caps.drivers.mysql.lock = { support: 'unsupported', reason: 'Serverversion zu alt.' };
    vi.mocked(accountsClient.capabilities).mockResolvedValue(caps);
    vi.mocked(accountsClient.access).mockResolvedValue({
      actions: ['create', 'unlock'],
      notes: ['Eingeschränkte Verbindung.'],
    });
    mount();
    await ready();
    expect(screen.getByRole('option', { name: 'Konto sperren' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Konto entsperren' })).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Benutzer löschen' })).toBeDisabled();
    expect(screen.getByText(/Serverversion zu alt/)).toBeInTheDocument();
    expect(screen.getByText('Eingeschränkte Verbindung.')).toBeVisible();
  });
  it('builds a scoped column grant without irrelevant fields', async () => {
    const { plans } = arrange();
    mount('postgresql');
    await select('grant');
    await fireEvent.change(screen.getByLabelText('Geltungsbereich'), {
      target: { value: 'column' },
    });
    for (const [label, value] of [
      ['Datenbank', 'synthetic'],
      ['Schema', 'public'],
      ['Tabelle oder Routine', 'orders'],
      ['Spalte', 'note'],
    ]) {
      await fireEvent.input(screen.getByLabelText(label, { exact: true }), { target: { value } });
    }
    await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
    await waitFor(() => expect(plans).toHaveBeenCalled());
    expect(plans.mock.calls[0][1]).toMatchObject({
      account: ref,
      grant: {
        scope: 'column',
        privilege: 'SELECT',
        grant_option: false,
        database: 'synthetic',
        schema: 'public',
        object: 'orders',
        column: 'note',
      },
    });
    expect(plans.mock.calls[0][1].grant).not.toHaveProperty('routine_id');
  });
  it('prepares exact routine revocation from the rights matrix', async () => {
    const { plans } = arrange();
    mount('postgresql');
    await select('revoke');
    const table = await screen.findByTestId('grants-routine');
    await fireEvent.click(within(table).getByRole('button', { name: 'Entzug vorbereiten' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
    expect(plans.mock.calls[0][1].grant).toEqual(details().grants[4]);
  });
  it('discards inspection and plan answers after token change and clears secret', async () => {
    const { plans } = arrange();
    const view = mount();
    await select('password');
    await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
    const password = await screen.findByLabelText('Neues Passwort');
    await fireEvent.input(password, { target: { value: 'synthetic-secret' } });
    const late = deferred<Schemas['AccountDetails']>();
    vi.mocked(accountsClient.inspect).mockReturnValue(late.promise);
    await view.rerender({ ...view.props, token: 'new-token' });
    await ready();
    late.resolve(details());
    await waitFor(() => expect(screen.queryByLabelText('Neues Passwort')).toBeNull());
    expect(screen.queryByText('synthetic_role@%')).toBeNull();
    expect(plans).toHaveBeenCalledTimes(1);
  });
  it('renders hostile backend text only as text', async () => {
    const { plans } = arrange();
    plans.mockResolvedValue(
      plan('drop', {
        statements: ['<img src=x onerror=alert(1)>'],
        warnings: ['<script>bad()</script>'],
      }),
    );
    mount();
    await select('drop');
    await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
    await screen.findByText('<img src=x onerror=alert(1)>');
    expect(document.querySelector('.accounts-panel img')).toBeNull();
    expect(document.querySelector('.accounts-panel script')).toBeNull();
  });
  it('keeps an unknown outcome visible and never repeats the write', async () => {
    const { executes } = arrange();
    executes.mockImplementation(async (_a, _b, _t, dispatch) => {
      dispatch();
      throw new ApiError('outcome_unknown', 'raw');
    });
    mount();
    await select('drop');
    await fireEvent.click(screen.getByRole('button', { name: 'Plan anzeigen' }));
    await screen.findByLabelText('Getippte Kontokennung');
    await confirm();
    await fireEvent.click(screen.getByRole('button', { name: 'Bestätigt ausführen' }));
    await screen.findByText(/Diese Ausführung ist abgeschlossen/);
    expect(screen.getAllByText(/Der Ausgang ist unbekannt/).length).toBeGreaterThan(0);
    expect(executes).toHaveBeenCalledTimes(1);
  });
});
