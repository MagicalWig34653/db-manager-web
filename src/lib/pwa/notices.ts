// SPDX-License-Identifier: AGPL-3.0-only
// Minimal status strip for the PWA: offline hint and "new version" action, built with DOM nodes.

import { t } from '$lib/i18n';

export const offlineText = () => t('coreText.offline');
export const updateText = () => t('coreText.updateAvailable');
export const updateAction = () => t('coreText.updateAction');

export interface Notices {
  setOffline(offline: boolean): void;
  showUpdate(onAccept: () => void): void;
}

export function createNotices(doc: Document): Notices {
  const strip = doc.createElement('div');
  strip.setAttribute('data-pwa-notices', '');
  strip.setAttribute('role', 'status');
  strip.setAttribute('aria-live', 'polite');
  Object.assign(strip.style, {
    position: 'fixed',
    left: '0',
    right: '0',
    bottom: '0',
    zIndex: '2147483000',
    display: 'none',
    flexWrap: 'wrap',
    gap: '0.5rem 1rem',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '0.5rem 1rem',
    background: '#172238',
    color: '#fff',
    font: '14px/1.4 system-ui, sans-serif',
  });
  const offline = doc.createElement('span');
  offline.setAttribute('data-pwa-offline', '');
  offline.textContent = offlineText();
  offline.hidden = true;
  const update = doc.createElement('span');
  update.setAttribute('data-pwa-update', '');
  update.hidden = true;
  const message = doc.createElement('span');
  message.textContent = updateText();
  const action = doc.createElement('button');
  action.type = 'button';
  action.textContent = updateAction();
  Object.assign(action.style, {
    marginLeft: '0.75rem',
    padding: '0.25rem 0.75rem',
    border: '1px solid #fff',
    borderRadius: '0.35rem',
    background: 'transparent',
    color: '#fff',
    font: 'inherit',
    cursor: 'pointer',
  });
  update.append(message, action);
  strip.append(offline, update);

  const refresh = (): void => {
    strip.style.display = offline.hidden && update.hidden ? 'none' : 'flex';
  };
  const attach = (): void => {
    if (!strip.isConnected) {
      doc.body.append(strip);
    }
  };

  return {
    setOffline(isOffline) {
      attach();
      offline.textContent = offlineText();
      offline.hidden = !isOffline;
      refresh();
    },
    showUpdate(onAccept) {
      attach();
      message.textContent = updateText();
      action.textContent = updateAction();
      update.hidden = false;
      action.onclick = () => {
        action.disabled = true;
        onAccept();
      };
      refresh();
    },
  };
}
