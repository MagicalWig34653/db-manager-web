// SPDX-License-Identifier: AGPL-3.0-only
// Service worker registration and the two small PWA notices (offline, new version). Loaded as its own
// module from index.html so the application shell stays untouched. Production builds only.
// The notices use plain DOM nodes; no credentials, tokens or API data are read or stored here.
import { createNotices } from './notices';
import { serverReachable } from './probe';

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    return;
  }
  const notices = createNotices(document);
  let reloadRequested = false;

  const offerUpdate = (worker: ServiceWorker): void =>
    notices.showUpdate(() => {
      reloadRequested = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // First installation also claims the page; only reload after the user accepted an update.
    if (reloadRequested) {
      window.location.reload();
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './', updateViaCache: 'none' })
      .then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          offerUpdate(registration.waiting);
        }
        registration.addEventListener('updatefound', () => {
          const incoming = registration.installing;
          incoming?.addEventListener('statechange', () => {
            if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
              offerUpdate(incoming);
            }
          });
        });
        // Look for a new release when the app returns to the foreground.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            void registration.update().catch(() => undefined);
          }
        });
      })
      .catch(() => undefined);
  });

  const probe = async (): Promise<void> => {
    if (!navigator.onLine) {
      notices.setOffline(true);
      return;
    }
    notices.setOffline(!(await serverReachable()));
  };
  window.addEventListener('online', () => void probe());
  window.addEventListener('offline', () => notices.setOffline(true));
  void probe();
}

registerServiceWorker();
