// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor } from '@testing-library/svelte';
import { it, expect, vi } from 'vitest';
import StructurePanel from './StructurePanel.svelte';
import { structure } from '$lib/structure';
import { emptyConnection } from '$lib/workbench';
import { syntheticStructure } from '../../../tests/fixtures/structure';
it('renders ordered term roles, conservative flags and same-name constraint namespaces without navigation', async () => {
  const read = vi.spyOn(structure, 'read').mockResolvedValue(syntheticStructure);
  try {
    render(StructurePanel, {
      connection: { ...emptyConnection(), database: 'synthetic' },
      table: syntheticStructure.table,
      token: 'synthetic-token',
    });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Index idx' })).toBeVisible());
    expect(screen.getByRole('article', { name: 'Eindeutigkeit shared' })).toBeVisible();
    expect(screen.getByRole('article', { name: 'Fremdschlüssel shared' })).toBeVisible();
    expect(screen.getByRole('article', { name: 'Prüfbedingung (CHECK) shared' })).toBeVisible();
    expect(screen.getByText('Ausdruck (Definition nicht geliefert)')).toBeVisible();
    expect(screen.getByText('Mitgeführter Wert (INCLUDE)')).toBeVisible();
    expect(screen.getByText('Hilfsterm')).toBeVisible();
    expect(screen.getByText('12 · Einheit unbekannt')).toBeVisible();
    expect(screen.getByText('Teilweise erfasst')).toBeVisible();
    expect(screen.getByText('Nicht verfügbar')).toBeVisible();
    expect(screen.getAllByText('Unbekannt').length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    read.mockRestore();
  }
});
it('unmount aborts the structure request and rejects late old-session data', async () => {
  let signal: AbortSignal | undefined;
  let finish!: (value: typeof syntheticStructure) => void;
  const read = vi
    .spyOn(structure, 'read')
    .mockImplementation((_connection, _table, _token, requestSignal) => {
      signal = requestSignal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
  try {
    const view = render(StructurePanel, {
      connection: { ...emptyConnection(), database: 'synthetic' },
      table: syntheticStructure.table,
      token: 'synthetic-token',
    });
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    view.unmount();
    expect(signal?.aborted).toBe(true);
    finish(syntheticStructure);
    await Promise.resolve();
    expect(screen.queryByRole('article', { name: 'Index idx' })).not.toBeInTheDocument();
  } finally {
    read.mockRestore();
  }
});
