// SPDX-License-Identifier: AGPL-3.0-only
// Iterates over every vendored API contract: src/lib/contract/ (0.1.0) and src/lib/contract/v<N>/ (0.<N>.0).
// Usage: node scripts/contracts.mjs generate|check|validators-generate|validators-check
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const modes = ['generate', 'check', 'validators-generate', 'validators-check'];
const mode = process.argv[2];
if (!modes.includes(mode)) {
  console.error(`Usage: node scripts/contracts.mjs ${modes.join('|')}`);
  process.exit(2);
}
const checking = mode.endsWith('check');
const withTypes = !mode.startsWith('validators');
const root = new URL('../', import.meta.url);
const base = new URL('src/lib/contract/', root);
const majors = [
  1,
  ...readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^v[0-9]+$/.test(entry.name))
    .map((entry) => Number(entry.name.slice(1))),
].sort((a, b) => a - b);
if (new Set(majors).size !== majors.length) throw new Error('Duplicate contract directories.');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: fileURLToPath(root), stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const openapi = fileURLToPath(new URL('node_modules/openapi-typescript/bin/cli.js', root));
for (const major of withTypes ? majors : []) {
  const folder = major === 1 ? 'src/lib/contract' : `src/lib/contract/v${major}`;
  const spec = `${folder}/api-v0.${major}.0.json`;
  if (!existsSync(new URL(spec, root))) throw new Error(`Missing contract file ${spec}.`);
  run(process.execPath, [
    openapi,
    spec,
    '--default-non-nullable',
    'false',
    '-o',
    `${folder}/api-types.ts`,
    ...(checking ? ['--check'] : []),
  ]);
}
for (const major of majors) {
  run(process.execPath, [
    'tests/generate-validators.mjs',
    ...(major === 1 ? [] : [`--v${major}`]),
    ...(checking ? ['--check'] : []),
  ]);
}
