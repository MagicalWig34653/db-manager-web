// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ResultTable from './ResultTable.svelte';

describe('precision-safe result rendering', () => {
  it('renders NULL, empty text, binary, duplicate column names and large integers distinctly', () => {
    render(ResultTable, {
      result: {
        columns: ['same', 'same', 'empty', 'blob'].map((name) => ({ name, type: 'SYNTHETIC' })),
        rows: [
          [
            { kind: 'null' },
            { kind: 'integer', value: '9007199254740993123456789' },
            { kind: 'text', value: '' },
            { kind: 'binary', value: 'AAEC' },
          ],
        ],
        truncated: false,
      },
    });
    expect(screen.getAllByText('same')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'null: NULL' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'text:' })).toHaveTextContent('""');
    expect(screen.getByText('9007199254740993123456789')).toBeVisible();
    expect(screen.getByRole('button', { name: 'binary: AAEC' })).toBeVisible();
  });
});
