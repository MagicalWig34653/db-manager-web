// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { it, expect, vi } from 'vitest';
import CreateTableDialog from './CreateTableDialog.svelte';
import { createTable } from '$lib/create-table';
import { emptyConnection } from '$lib/workbench';
it('keeps a confirmed create visible when the subsequent readonly catalog refresh fails and prevents double submission', async () => {
  const cap = vi.spyOn(createTable, 'capabilities').mockResolvedValue({} as never);
  const create = vi
    .spyOn(createTable, 'create')
    .mockImplementation(async (_input, _token, _signal, dispatch) => {
      dispatch();
      return {
        outcome: 'created',
        structure_check: 'unavailable',
        snapshot_atomic: false,
        message: 'Anlage bestätigt, Strukturprüfung nicht verfügbar.',
      };
    });
  const refresh = vi.fn().mockRejectedValue(new Error('synthetic catalog failure'));
  const phases = vi.fn();
  try {
    render(CreateTableDialog, {
      connection: { ...emptyConnection(), database: 'synthetic' },
      token: 'synthetic-token',
      signal: new AbortController().signal,
      onclose: vi.fn(),
      oncreated: refresh,
      onwritephase: phases,
    });
    await screen.findByLabelText('Neuer Tabellenname');
    await fireEvent.input(screen.getByLabelText('Neuer Tabellenname'), {
      target: { value: 'created' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Definition prüfen' }));
    const submit = screen.getByRole('button', { name: 'Tabelle verbindlich anlegen' });
    expect(submit).toBeDisabled();
    await fireEvent.click(screen.getByLabelText('Tabellenanlage ausdrücklich bestätigen'));
    await fireEvent.click(submit);
    await fireEvent.click(submit);
    await screen.findByRole('heading', { name: 'Anlage bestätigt' });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Anlage bleibt bestätigt'),
    );
    expect(create).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    expect(phases.mock.calls.map(([phase]) => phase)).toEqual(['sending', 'settled']);
  } finally {
    cap.mockRestore();
    create.mockRestore();
  }
});
