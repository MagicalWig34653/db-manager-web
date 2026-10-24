// SPDX-License-Identifier: AGPL-3.0-only
// Reachability probe for the offline hint. Any HTTP status proves the server answered; only a
// network failure or timeout counts as "unreachable". The response body is always discarded so the
// request is finished and never stays open (it would keep the page from becoming network-idle).

export const PROBE_TIMEOUT_MS = 5000;

export async function serverReachable(
  fetcher: typeof fetch = fetch,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher('/healthz', {
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    try {
      await response.body?.cancel();
    } catch {
      // The status already proved reachability; a failing cancel changes nothing.
    }
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
