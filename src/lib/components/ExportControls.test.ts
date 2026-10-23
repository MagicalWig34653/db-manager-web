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
