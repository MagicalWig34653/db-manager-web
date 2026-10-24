// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api';
import type { ConnectionDraft } from '$lib/workbench';
import CreateTablePanel from './CreateTablePanel.svelte';
import { createClient } from './client';
import { createCapabilities, createResult } from '../../../../tests/fixtures/create';

const sqlite: ConnectionDraft = {
  name: '',
  driver: 'sqlite',
  database: 'synthetic',
  host: '',
  port: 0,
  username: '',
  password: '',
};
const props = (patch: Record<string, unknown> = {}) => ({
  connection: sqlite,
  token: 'tok',
  tab: 'tabelle-anlegen',
  onsql: () => {},
  onwritephase: () => {},
  ...patch,
});
let capabilities: ReturnType<typeof vi.spyOn>;
let create: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  capabilities = vi
    .spyOn(createClient, 'capabilities')
    .mockResolvedValue(createCapabilities as never);
  create = vi.spyOn(createClient, 'create').mockResolvedValue(createResult() as never);
});
afterEach(() => vi.restoreAllMocks());

async function fillAndReview(name = 'orders') {
  await fireEvent.input(await screen.findByLabelText('Tabellenname'), { target: { value: name } });
  await fireEvent.click(screen.getByRole('button', { name: 'Definition prüfen' }));
  return await screen.findByTestId('create-review');
}
const submit = () => screen.getByRole('button', { name: 'Tabelle anlegen' });
const confirm = () => screen.getByRole('checkbox', { name: /Ich bestätige/ });

describe('create table panel', () => {
  it('explains instances without table creation instead of showing a form', async () => {
    capabilities.mockRejectedValue(new ApiError('unsupported_feature', 'x'));
    render(CreateTablePanel, props());
    expect(await screen.findByText('Tabellenanlage nicht verfügbar')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tabellenname')).toBeNull();
  });
  it('shows the SQLite type notes only for SQLite and the schema field only elsewhere', async () => {
    const view = render(CreateTablePanel, props());
    expect(await screen.findByTestId('sqlite-note')).toHaveTextContent('rowid');
    expect(screen.queryByLabelText('Schema (optional)')).toBeNull();
    view.unmount();
    render(CreateTablePanel, props({ connection: { ...sqlite, driver: 'postgresql' } }));
    expect(await screen.findByLabelText('Schema (optional)')).toBeInTheDocument();
    expect(screen.queryByTestId('sqlite-note')).toBeNull();
  });
  it('sends no request while the form is edited or merely reviewed', async () => {
    render(CreateTablePanel, props());
    await fillAndReview();
    expect(submit()).toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });
  it('blocks the review while the definition is invalid', async () => {
    render(CreateTablePanel, props());
    await screen.findByLabelText('Tabellenname');
    expect(screen.getByRole('button', { name: 'Definition prüfen' })).toBeDisabled();
    expect(screen.getByTestId('create-issues')).toHaveTextContent('Tabellennamen');
  });
  it('sends exactly one request on a double click and shows the separate structure check', async () => {
    let release: (value: unknown) => void = () => {};
    create.mockReturnValue(new Promise((resolve) => (release = resolve)) as never);
    render(CreateTablePanel, props());
    await fillAndReview('odd"name\' DROP TABLE x;--');
    await fireEvent.click(confirm());
    const button = submit();
    await fireEvent.click(button);
    await fireEvent.click(button);
    await fireEvent.click(button);
    expect(create).toHaveBeenCalledTimes(1);
    const request = create.mock.calls[0][0] as { confirm: boolean; table: { name: string } };
    expect(request.confirm).toBe(true);
    expect(request.table.name).toBe('odd"name\' DROP TABLE x;--');
    release(createResult('observed'));
    expect(await screen.findByTestId('create-result')).toBeInTheDocument();
    expect(screen.getByTestId('structure-check')).toHaveTextContent('observed');
    expect(screen.getByTestId('actual-structure')).toHaveTextContent('BIGINT');
    expect(create).toHaveBeenCalledTimes(1);
  });
  it.each(['transactional', 'observed', 'different', 'unavailable'] as const)(
    'renders structure_check %s',
    async (check) => {
      create.mockResolvedValue(createResult(check) as never);
      render(CreateTablePanel, props());
      await fillAndReview();
      await fireEvent.click(confirm());
      await fireEvent.click(submit());
      expect(await screen.findByTestId('structure-check')).toHaveTextContent(check);
      expect(screen.queryByTestId('actual-structure') === null).toBe(check === 'unavailable');
    },
  );
  it('keeps the form after a name conflict (409) and does not report success', async () => {
    create.mockRejectedValue(new ApiError('create_conflict', 'x'));
    render(CreateTablePanel, props());
    await fillAndReview();
    await fireEvent.click(confirm());
    await fireEvent.click(submit());
    expect(await screen.findByTestId('create-error')).toHaveTextContent('nicht verändert');
    expect(screen.queryByTestId('create-result')).toBeNull();
    expect(screen.getByLabelText('Tabellenname')).toHaveValue('orders');
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('offers no retry after an unknown outcome and locks the form', async () => {
    create.mockRejectedValue(new ApiError('outcome_unknown', 'x'));
    render(CreateTablePanel, props());
    await fillAndReview();
    await fireEvent.click(confirm());
    await fireEvent.click(submit());
    const alert = await screen.findByTestId('create-unknown');
    expect(alert).toHaveTextContent('Nicht erneut senden');
    expect(screen.queryByRole('button', { name: 'Tabelle anlegen' })).toBeNull();
    expect(screen.queryByRole('button', { name: /erneut|Wiederholen/i })).toBeNull();
    expect(screen.queryByLabelText('Tabellenname')).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('discards an answer that arrives after a token change', async () => {
    let release: (value: unknown) => void = () => {};
    create.mockReturnValue(new Promise((resolve) => (release = resolve)) as never);
    const view = render(CreateTablePanel, props());
    await fillAndReview();
    await fireEvent.click(confirm());
    await fireEvent.click(submit());
    await view.rerender(props({ token: 'other-token' }));
    release(createResult());
    await waitFor(() => expect(screen.getByLabelText('Tabellenname')).toHaveValue(''));
    expect(screen.queryByTestId('create-result')).toBeNull();
  });
  it('discards an answer that arrives after a connection change', async () => {
    let release: (value: unknown) => void = () => {};
    create.mockReturnValue(new Promise((resolve) => (release = resolve)) as never);
    const view = render(CreateTablePanel, props());
    await fillAndReview();
    await fireEvent.click(confirm());
    await fireEvent.click(submit());
    await view.rerender(props({ connection: { ...sqlite, database: 'other' } }));
    release(createResult());
    await waitFor(() => expect(screen.getByLabelText('Tabellenname')).toHaveValue(''));
    expect(screen.queryByTestId('create-result')).toBeNull();
  });
  it('keeps the primary key ordered, allows it to be empty and drops NULL for key columns', async () => {
    render(CreateTablePanel, props());
    await screen.findByLabelText('Tabellenname');
    expect(screen.getByText(/ohne Primärschlüssel angelegt/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Spalte hinzufügen' }));
    await fireEvent.input(screen.getByLabelText('Spaltenname 2'), { target: { value: 'code' } });
    await fireEvent.click(screen.getByLabelText('Spalte 2 gehört zum Primärschlüssel'));
    await fireEvent.click(screen.getByLabelText('Spalte 1 gehört zum Primärschlüssel'));
    expect(screen.getByLabelText('Spalte 2 darf NULL enthalten')).toBeDisabled();
    const order = () => screen.getByTestId('key-order').textContent;
    expect(order()).toMatch(/code.*id/);
    await fireEvent.click(
      screen.getByRole('button', { name: 'Primärschlüsselspalte id nach oben' }),
    );
    expect(order()).toMatch(/id.*code/);
  });
  it('does not allow binary or decimal columns into the primary key', async () => {
    render(CreateTablePanel, props());
    await screen.findByLabelText('Tabellenname');
    await fireEvent.change(screen.getByLabelText('Typ von Spalte 1'), {
      target: { value: 'binary' },
    });
    expect(screen.getByLabelText('Spalte 1 gehört zum Primärschlüssel')).toBeDisabled();
  });
  it('limits the form to 32 columns', async () => {
    render(CreateTablePanel, props());
    await screen.findByLabelText('Tabellenname');
    for (let i = 0; i < 40; i++) {
      const button = screen.getByRole('button', { name: 'Spalte hinzufügen' });
      if ((button as HTMLButtonElement).disabled) break;
      await fireEvent.click(button);
    }
    expect(screen.getByLabelText('Spaltenname 32')).toBeInTheDocument();
    expect(screen.queryByLabelText('Spaltenname 33')).toBeNull();
    expect(screen.getByRole('button', { name: 'Spalte hinzufügen' })).toBeDisabled();
  });
});
