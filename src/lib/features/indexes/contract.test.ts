// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import * as validators from '$lib/contract/v13/validators.js';
import provenance from '$lib/contract/v13/provenance.json';
const root = process.cwd();
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
describe('v13 provenance and fixtures', () => {
  it('pins the copied bytes and checks the backend worktree when present', () => {
    expect(digest(resolve(root, 'src/lib/contract/v13/api-v0.13.0.json'))).toBe(provenance.sha256);
    const backend =
      process.env.DBM_BACKEND_REPO ??
      resolve(root, '../../../../GoLand/db-manager/.worktrees/w-p09-backend');
    const source = resolve(backend, provenance.source_path);
    if (existsSync(source)) expect(digest(source)).toBe(provenance.sha256);
    expect(provenance.source_commit).toMatch(/^[a-f0-9]{40}$/);
  });
  const folder = resolve(root, 'src/lib/features/indexes/fixtures');
  for (const name of readdirSync(folder).filter((name) => name.endsWith('.json'))) {
    it(`validates ${name}`, () => {
      const validate = validators[name.split('.')[0] as keyof typeof validators];
      expect(validate).toBeTypeOf('function');
      expect(validate(JSON.parse(readFileSync(resolve(folder, name), 'utf8')))).toBe(
        !name.includes('.invalid.'),
      );
    });
  }
});
