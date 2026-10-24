// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { createNotices, OFFLINE_TEXT, UPDATE_ACTION } from './notices';

describe('pwa notices', () => {
  it('stays hidden and detached until a notice is needed', () => {
    document.body.replaceChildren();
    createNotices(document);
    expect(document.querySelector('[data-pwa-notices]')).toBeNull();
  });

  it('shows and clears the offline hint', () => {
    document.body.replaceChildren();
    const notices = createNotices(document);
    notices.setOffline(true);
    const strip = document.querySelector<HTMLElement>('[data-pwa-notices]')!;
    expect(strip.style.display).toBe('flex');
    expect(strip.textContent).toContain(OFFLINE_TEXT);
    expect(strip.querySelector<HTMLElement>('[data-pwa-offline]')!.hidden).toBe(false);
    notices.setOffline(false);
    expect(strip.style.display).toBe('none');
  });

  it('runs the update action once and disables the button', () => {
    document.body.replaceChildren();
    const notices = createNotices(document);
    const accept = vi.fn();
    notices.showUpdate(accept);
    const button = document.querySelector<HTMLButtonElement>('[data-pwa-update] button')!;
    expect(button.textContent).toBe(UPDATE_ACTION);
    button.click();
    button.click();
    expect(accept).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
  });
});
