// SPDX-License-Identifier: AGPL-3.0-only
// Independent review of web wave 2: server administration and monitor are read-only. The sources must not
// contain any route, helper or wording that could change server state (SET, KILL, FLUSH, ...).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = join(process.cwd(), 'src/lib/features');
function sources(feature: string): [string, string][] {
  const dir = join(here, feature);
  return readdirSync(dir)
    .filter(
      (name) => /\.(ts|svelte)$/.test(name) && !/\.test\.ts$/.test(name) && name !== 'testing.ts',
    )
    .map((name) => [name, readFileSync(join(dir, name), 'utf8')]);
}

describe.each(['server-admin', 'monitor'])('%s source', (feature) => {
  const files = sources(feature);
  it('only calls the documented read routes', () => {
    const routes = files.flatMap(([, text]) =>
      [...text.matchAll(/['`]\/api\/[^'`]*['`]/g)].map((m) => m[0]),
    );
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes)
      expect(route).toMatch(
        /^[`']\/api\/v(17|20)\/(capabilities|\$\{(kind|action)\}|(monitor\/)\$\{action\})[`']$/,
      );
  });
  it('has no write verbs in code (comments excluded)', () => {
    for (const [name, text] of files) {
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code, name).not.toMatch(
        /\b(KILL|FLUSH|PURGE|SHUTDOWN)\b|pg_terminate_backend|pg_cancel_backend/,
      );
      expect(code, name).not.toMatch(/method:\s*['"](PUT|DELETE|PATCH)['"]/);
      expect(code, name).not.toMatch(/\bonwritephase\b/);
    }
  });
});
