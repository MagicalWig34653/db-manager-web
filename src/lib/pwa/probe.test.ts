// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { serverReachable } from './probe';

function streamResponse(status: number) {
  const cancel = vi.fn(async () => undefined);
  const response = { status, body: { cancel } } as unknown as Response;
  return { response, cancel };
}

describe('serverReachable', () => {
  it('discards the response body for success and error statuses', async () => {
    for (const status of [200, 401, 503]) {
      const { response, cancel } = streamResponse(status);
      const fetcher = vi.fn(async () => response) as unknown as typeof fetch;
      expect(await serverReachable(fetcher)).toBe(true);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledWith(
        '/healthz',
        expect.objectContaining({ cache: 'no-store', credentials: 'omit' }),
      );
    }
  });

  it('tolerates responses without a body and a failing cancel', async () => {
    const noBody = vi.fn(async () => ({ status: 204, body: null }) as Response) as typeof fetch;
    expect(await serverReachable(noBody)).toBe(true);
    const failing = vi.fn(
      async () =>
        ({
          status: 200,
          body: {
            cancel: async () => {
              throw new Error('locked');
            },
          },
        }) as unknown as Response,
    ) as typeof fetch;
    expect(await serverReachable(failing)).toBe(true);
  });

  it('reports unreachable on network failure', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await serverReachable(fetcher)).toBe(false);
  });

  it('aborts a hanging request after the timeout', async () => {
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')));
        }),
    ) as unknown as typeof fetch;
    expect(await serverReachable(fetcher, 10)).toBe(false);
    expect(signal?.aborted).toBe(true);
  });
});
