// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, fireEvent } from '@testing-library/svelte';
import { it, expect, vi } from 'vitest';
import ExportControls from './ExportControls.svelte';
import { MAX_EXPORT_BYTES } from '$lib/export';
it('rejects an oversized final export before any Blob URL is created', async () => {
  const create = vi.fn();
  vi.stubGlobal(
    'URL',
    class {
      static createObjectURL = create;
      static revokeObjectURL = vi.fn();
    },
  );
  try {
    render(ExportControls, {
      result: {
        columns: [{ name: 'x', type: '' }],
        rows: [[{ kind: 'text', value: 'x'.repeat(MAX_EXPORT_BYTES) }]],
        truncated: false,
      },
      scope: { kind: 'sql_result' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Ergebnis herunterladen' }));
    expect(screen.getByRole('alert')).toHaveTextContent('8 MiB');
    expect(create).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('QA-F6-01: refuses both CSV variants before Blob URL creation and recommends unchanged JSON', async () => {
  const create = vi.fn();
  vi.stubGlobal(
    'URL',
    class {
      static createObjectURL = create;
      static revokeObjectURL = vi.fn();
    },
  );
  try {
    const view = render(ExportControls, {
      result: {
        columns: [{ name: 'x', type: '' }],
        rows: [[{ kind: 'text', value: '\u0000\u0001\t' }]],
        truncated: false,
      },
      scope: { kind: 'sql_result' },
    });
    for (const format of ['csv-raw', 'csv-spreadsheet']) {
      await fireEvent.change(screen.getByLabelText('Exportformat'), { target: { value: format } });
      await fireEvent.click(screen.getByRole('button', { name: 'Ergebnis herunterladen' }));
      expect(screen.getByRole('alert')).toHaveTextContent('JSON unverändert');
      expect(create).not.toHaveBeenCalled();
    }
    view.unmount();
  } finally {
    vi.unstubAllGlobals();
  }
});
