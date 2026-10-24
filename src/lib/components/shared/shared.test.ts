// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
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
  const input = screen.getByRole('textbox', {
    name: 'Zur Bestätigung den Namen „orders“ eingeben',
  });
  expect(input).toHaveFocus();
  expect(button).toBeDisabled();
  await fireEvent.input(input, { target: { value: 'order' } });
  expect(button).toBeDisabled();
  await fireEvent.input(input, { target: { value: 'Orders' } });
  expect(button).toBeDisabled();
  await fireEvent.click(button);
  expect(onconfirm).not.toHaveBeenCalled();
  await fireEvent.input(input, { target: { value: 'orders' } });
  expect(button).toBeEnabled();
  // Enter alone never confirms; it only moves focus to the explicit button.
  await fireEvent.submit(input.closest('form')!);
  expect(onconfirm).not.toHaveBeenCalled();
  expect(button).toHaveFocus();
  await fireEvent.click(button);
  expect(onconfirm).toHaveBeenCalledOnce();
});

it('reports cancellation for the button, Escape and a closed dialog, but not for confirm', async () => {
  const oncancel = vi.fn();
  const view = render(ConfirmDestructiveDialog, {
    open: true,
    title: 'Löschen',
    targetName: 'x',
    onconfirm: vi.fn(),
    oncancel,
  });
  await fireEvent.click(await screen.findByRole('button', { name: 'Abbrechen' }));
  await waitFor(() => expect(oncancel).toHaveBeenCalledTimes(1));
  view.unmount();

  const second = vi.fn();
  render(ConfirmDestructiveDialog, {
    open: true,
    title: 'Löschen',
    targetName: 'x',
    onconfirm: vi.fn(),
    oncancel: second,
  });
  const input = await screen.findByRole('textbox');
  await fireEvent.keyDown(input, { key: 'Escape' });
  await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
});

it('does not report cancellation after a confirmed action closes the dialog', async () => {
  const oncancel = vi.fn();
  let close = () => {};
  const view = render(ConfirmDestructiveDialog, {
    open: true,
    title: 'Löschen',
    targetName: 'x',
    onconfirm: () => close(),
    oncancel,
  });
  close = () => void view.rerender({ open: false });
  const input = await screen.findByRole('textbox');
  await fireEvent.input(input, { target: { value: 'x' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Endgültig ausführen' }));
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(oncancel).not.toHaveBeenCalled();
});

it('gives two simultaneous dialogs distinct field ids', async () => {
  render(ConfirmDestructiveDialog, { open: true, title: 'A', targetName: 'a', onconfirm: vi.fn() });
  render(ConfirmDestructiveDialog, { open: true, title: 'B', targetName: 'b', onconfirm: vi.fn() });
  const ids = (await screen.findAllByRole('textbox')).map((input) => input.id);
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
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
