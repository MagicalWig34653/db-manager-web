// SPDX-License-Identifier: AGPL-3.0-only
// Test helpers: fixtures (unchanged backend answers, see fixtures/README.md) and a scripted fetch.
import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import { ApiClient } from '$lib/api';
import { PartitionsClient } from './client';

export const fx = (name: string) =>
  JSON.parse(readFileSync(`src/lib/features/partitions/fixtures/${name}.json`, 'utf8'));
export const json = { 'Content-Type': 'application/json' };
export const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: json });
export function scripted(
  handler: (
    path: string,
    body: Record<string, unknown> | undefined,
  ) => Response | Promise<Response>,
) {
  const calls: { path: string; body: Record<string, unknown> | undefined }[] = [];
  const fetcher = vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: String(path), body });
    return handler(String(path), body);
  });
  return { calls, client: new PartitionsClient(new ApiClient(fetcher as unknown as typeof fetch)) };
}
