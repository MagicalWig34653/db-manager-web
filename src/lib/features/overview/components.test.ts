// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyConnection } from '$lib/workbench';
import {
  overviewClient,
  type DefinitionResult,
  type ObjectsResult,
  type OverviewCapabilities,
  type ServerInfoResult,
} from './client';
import ObjectsTab from './ObjectsTab.svelte';
import DefinitionTab from './DefinitionTab.svelte';
import ServerInfoPanel from './ServerInfoPanel.svelte';

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(`src/lib/features/overview/fixtures/${name}`, 'utf8'));
const support = (
  value: 'supported' | 'limited' | 'unsupported' = 'supported',
  reason?: string,
) => ({
  support: value,
  ...(reason ? { reason } : {}),
});
const driverCaps = (over: Record<string, ReturnType<typeof support>> = {}) => ({
  databases: support(),
  objects: support(),
  definition: support(),
  server_info: support(),
  exact_rows: support(),
  ...over,
});
const caps = (over: Record<string, ReturnType<typeof support>> = {}): OverviewCapabilities => ({
  contract_version: '0.7.0',
  features: ['databases', 'objects', 'definition', 'server_info'],
  mutations: false,
  drivers: { sqlite: driverCaps(over), mysql: driverCaps(over), postgres: driverCaps(over) },
  default_limit: 200,
  max_limit: 1000,
  max_offset: 1000000,
  max_exact_objects: 100,
  default_timeout_ms: 10000,
  max_timeout_ms: 30000,
  max_list_items: 1000,
  max_definition_bytes: 1048576,
  max_request_bytes: 1048576,
});
const connection = { ...emptyConnection(), database: 'p06_main' };
const props = {
  connection,
  token: 'tok',
  tab: 'uebersicht',
  onsql: () => {},
  onwritephase: () => {},
};

afterEach(() => vi.restoreAllMocks());

describe('ObjectsTab', () => {
  const estimated = (): ObjectsResult => {
    const data = fixture<ObjectsResult>('ObjectsResult.mysql-objects.json');
    return {
      ...data,
      exact_requested: false,
      objects: data.objects.map((object) => ({
        ...object,
        rows: { value: 7, state: 'estimated' },
      })),
    };
  };

  it('marks estimates, offers exact counting and shows exact values afterwards', async () => {
    vi.spyOn(overviewClient, 'capabilities').mockResolvedValue(caps());
    const objects = vi
      .spyOn(overviewClient, 'objects')
      .mockResolvedValueOnce(estimated())
      .mockResolvedValueOnce(fixture<ObjectsResult>('ObjectsResult.mysql-objects.json'));
    render(ObjectsTab, { ...props, connection: { ...connection, driver: 'mysql' } });
    await waitFor(() => expect(screen.getByTestId('objects-table')).toBeVisible());
    expect(screen.getAllByText('geschätzt').length).toBe(3);
    expect(screen.getAllByTestId('row-count')[0]).toHaveAttribute('data-state', 'estimated');
    expect(screen.getByTestId('estimate-hint')).toBeVisible();
    expect(objects.mock.calls[0][2]).toMatchObject({ schema: 'p06_main' });
    await fireEvent.click(screen.getByTestId('count-exact'));
    await waitFor(() => expect(screen.getByTestId('exact-done')).toBeVisible());
    expect(objects.mock.calls[1][2]).toMatchObject({ exactRows: true, limit: 100 });
    expect(screen.queryByText('geschätzt')).toBeNull();
    expect(screen.getAllByTestId('row-count')[0]).toHaveAttribute('data-state', 'exact');
  });

  it('reports an incomplete exact count instead of faking exact values', async () => {
    vi.spyOn(overviewClient, 'capabilities').mockResolvedValue(caps());
    const incomplete = {
      ...estimated(),
      exact_requested: true,
      exact_incomplete: true,
    };
    incomplete.objects[1].rows = { value: null, state: 'unknown' };
    vi.spyOn(overviewClient, 'objects')
      .mockResolvedValueOnce(estimated())
      .mockResolvedValueOnce(incomplete);
    render(ObjectsTab, props);
    await waitFor(() => expect(screen.getByTestId('count-exact')).toBeVisible());
    await fireEvent.click(screen.getByTestId('count-exact'));
    await waitFor(() => expect(screen.getByTestId('exact-incomplete')).toBeVisible());
    expect(screen.getByText('unbekannt')).toBeVisible();
  });

  it('explains an unsupported function instead of hiding it and does not request data', async () => {
    vi.spyOn(overviewClient, 'capabilities').mockResolvedValue(
      caps({ objects: support('unsupported', 'Nicht für diese Engine.') }),
    );
    const objects = vi.spyOn(overviewClient, 'objects');
    render(ObjectsTab, props);
    await waitFor(() => expect(screen.getByText('Nicht für diese Engine.')).toBeVisible());
    expect(objects).not.toHaveBeenCalled();
  });

  it('filters and shows a limit note with a way to load more', async () => {
    vi.spyOn(overviewClient, 'capabilities').mockResolvedValue(caps());
    const first = { ...estimated(), total: 5, has_more: true };
    const next = {
      ...first,
      offset: 3,
      objects: [{ ...first.objects[0], name: 'zzz' }],
      has_more: false,
    };
    const objects = vi
      .spyOn(overviewClient, 'objects')
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(next);
    render(ObjectsTab, props);
    await waitFor(() => expect(screen.getByTestId('objects-limit')).toBeVisible());
    expect(screen.getByTestId('objects-limit')).toHaveTextContent('3 von 5');
    await fireEvent.click(screen.getByRole('button', { name: 'Weitere laden' }));
    await waitFor(() => expect(screen.getByText('zzz')).toBeVisible());
    expect(objects.mock.calls[1][2]).toMatchObject({ offset: 3 });
    await fireEvent.input(screen.getByTestId('objects-filter'), { target: { value: 'zzz' } });
    expect(screen.queryByText('t_000')).toBeNull();
    expect(screen.getByText('zzz')).toBeVisible();
  });

  it('aborts on connection change and discards the late answer of the old connection', async () => {
    vi.spyOn(overviewClient, 'capabilities').mockResolvedValue(caps());
    const signals: AbortSignal[] = [];
    const finish: Array<(value: ObjectsResult) => void> = [];
    vi.spyOn(overviewClient, 'objects').mockImplementation(
      (_connection, _token, _query, signal) => {
        signals.push(signal as AbortSignal);
        return new Promise((resolve) => finish.push(resolve));
      },
    );
    const view = render(ObjectsTab, props);
    await waitFor(() => expect(signals.length).toBe(1));
    await view.rerender({ ...props, connection: { ...connection, database: 'other' } });
    await waitFor(() => expect(signals.length).toBe(2));
    expect(signals[0].aborted).toBe(true);
    const old = estimated();
    old.objects[0].name = 'from_old_connection';
    finish[0](old);
    const current = estimated();
    current.objects[0].name = 'from_new_connection';
    finish[1](current);
    await waitFor(() => expect(screen.getByText('from_new_connection')).toBeVisible());
    expect(screen.queryByText('from_old_connection')).toBeNull();
    view.unmount();
    expect(signals[1].aborted).toBe(true);
  });
});

describe('ServerInfoPanel', () => {
  it('shows server context, marks database values as estimated and keeps the page limit visible', async () => {
    vi.spyOn(overviewClient, 'capabilities').mockResolvedValue(caps());
    vi.spyOn(overviewClient, 'serverInfo').mockResolvedValue(
      fixture<ServerInfoResult>('ServerInfoResult.mysql-server-info.json'),
    );
    const list = fixture<{ databases: unknown[]; total: number }>(
      'DatabasesResult.mysql-databases.json',
    );
    vi.spyOn(overviewClient, 'databases').mockResolvedValue({
      ...list,
      total: list.databases.length + 5,
      has_more: true,
    } as never);
    render(ServerInfoPanel, { connection, token: 'tok' });
    await waitFor(() => expect(screen.getByTestId('server-facts')).toBeVisible());
    expect(screen.getByTestId('server-facts')).toHaveTextContent('MySQL');
    await waitFor(() => expect(screen.getByTestId('database-table')).toBeVisible());
    expect(screen.getAllByTestId('value-state')[0]).toHaveTextContent('geschätzt');
    expect(screen.getByTestId('databases-limit')).toBeVisible();
    expect(screen.queryByText(/password/i)).toBeNull();
  });

  it('explains missing server info support and still loads the rest', async () => {
    vi.spyOn(overviewClient, 'capabilities').mockResolvedValue(
      caps({ server_info: support('unsupported', 'Kein Serverinfo-Zugriff.') }),
    );
    const info = vi.spyOn(overviewClient, 'serverInfo');
    vi.spyOn(overviewClient, 'databases').mockResolvedValue(
      fixture('DatabasesResult.mysql-databases.json'),
    );
    render(ServerInfoPanel, { connection, token: 'tok' });
    await waitFor(() => expect(screen.getByText('Kein Serverinfo-Zugriff.')).toBeVisible());
    await waitFor(() => expect(screen.getByTestId('database-table')).toBeVisible());
    expect(info).not.toHaveBeenCalled();
  });

  it('shows a backend error with retry', async () => {
    vi.spyOn(overviewClient, 'capabilities').mockRejectedValue(new Error('Nicht erreichbar.'));
    render(ServerInfoPanel, { connection, token: 'tok' });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Nicht erreichbar.'));
  });
});

describe('DefinitionTab', () => {
  const object = { name: 'orders', schema: 'public', type: 'table' };

  it('marks a derived definition and copies the text', async () => {
    vi.spyOn(overviewClient, 'capabilities').mockResolvedValue(caps());
    const data = fixture<DefinitionResult>('DefinitionResult.postgres-definition-table.json');
    vi.spyOn(overviewClient, 'definition').mockResolvedValue(data);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(DefinitionTab, { ...props, object, tab: 'definition' });
    await waitFor(() => expect(screen.getByTestId('definition-derived')).toBeVisible());
    expect(screen.getByTestId('definition-text').textContent).toBe(data.definition);
    await fireEvent.click(screen.getByTestId('copy-definition'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(data.definition));
    await waitFor(() => expect(screen.getByTestId('copy-state')).toHaveTextContent('kopiert'));
  });

  it('shows no derived hint for a native definition and reports copy failure', async () => {
    vi.spyOn(overviewClient, 'capabilities').mockResolvedValue(caps());
    vi.spyOn(overviewClient, 'definition').mockResolvedValue(
      fixture<DefinitionResult>('DefinitionResult.mysql-definition-table.json'),
    );
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    render(DefinitionTab, { ...props, object, tab: 'definition' });
    await waitFor(() => expect(screen.getByTestId('definition-text')).toBeVisible());
    expect(screen.queryByTestId('definition-derived')).toBeNull();
    await fireEvent.click(screen.getByTestId('copy-definition'));
    await waitFor(() =>
      expect(screen.getByTestId('copy-state')).toHaveTextContent('Kopieren nicht möglich'),
    );
  });
});
