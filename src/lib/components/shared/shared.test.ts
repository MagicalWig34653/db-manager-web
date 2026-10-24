// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/svelte';
import { expect, it, vi } from 'vitest';
import ConfirmDestructiveDialog from './ConfirmDestructiveDialog.svelte';
import PlanPreview from './PlanPreview.svelte';
import CapabilityNotice from './CapabilityNotice.svelte';
import ErrorPanel from './ErrorPanel.svelte';

it('keeps destructive confirmation disabled until the exact target name is typed', async () => {
  const onconfirm = vi.fn();
  render(ConfirmDestructiveDialog, {
    open: true,
    title: 'Tabelle löschen',
    targetName: 'orders',
    onconfirm,
  });
  const button = await screen.findByRole('button', { name: 'Endgültig ausführen' });
  const input = screen.getByRole('textbox', { name: 'Name des Zielobjekts' });
  expect(button).toBeDisabled();
  await fireEvent.input(input, { target: { value: 'order' } });
  expect(button).toBeDisabled();
  await fireEvent.input(input, { target: { value: 'Orders' } });
  expect(button).toBeDisabled();
  await fireEvent.submit(input.closest('form')!);
  expect(onconfirm).not.toHaveBeenCalled();
  await fireEvent.input(input, { target: { value: 'orders' } });
  expect(button).toBeEnabled();
  await fireEvent.submit(input.closest('form')!);
  expect(onconfirm).toHaveBeenCalledOnce();
});

it('cancel closes the dialog and reports cancellation', async () => {
  const oncancel = vi.fn();
  render(ConfirmDestructiveDialog, {
    open: true,
    title: 'Löschen',
    targetName: 'x',
    onconfirm: vi.fn(),
    oncancel,
  });
  await fireEvent.click(await screen.findByRole('button', { name: 'Abbrechen' }));
  expect(oncancel).toHaveBeenCalledOnce();
});

it('shows plan statements read-only with warnings and hash', () => {
  render(PlanPreview, {
    statements: ['DROP TABLE "orders"'],
    warnings: ['Daten gehen verloren'],
    planSha256: 'abc123',
  });
  expect(screen.getByText('DROP TABLE "orders"')).toBeVisible();
  expect(screen.getByText('Daten gehen verloren')).toBeVisible();
  expect(screen.getByText('abc123')).toBeVisible();
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('renders capability notice and error panel with retry', async () => {
  render(CapabilityNotice, { reason: 'Nur mit MySQL.' });
  expect(screen.getByText('Nicht unterstützt')).toBeVisible();
  expect(screen.getByText('Nur mit MySQL.')).toBeVisible();
  const onretry = vi.fn();
  render(ErrorPanel, { message: 'Kaputt', onretry });
  expect(screen.getByRole('alert')).toHaveTextContent('Kaputt');
  await fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
  expect(onretry).toHaveBeenCalledOnce();
});
