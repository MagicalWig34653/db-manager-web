#!/usr/bin/env bash
# Review tooling: axe-core pass over every spec in tests/browser (final state + 320 px). Not part of CI.
# Usage: npm i --no-save axe-core && AXE_PORT=4480 scripts/review-axe.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${AXE_PORT:-4480}"
rm -rf tests/review-tmp && mkdir tests/review-tmp
for f in tests/browser/*.ts; do
  sed "s#from '@playwright/test'#from '../review/axe-fixture'#" "$f" > "tests/review-tmp/$(basename "$f")"
done
cat > pw-axe.config.ts <<EOC
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/review-tmp', fullyParallel: false, workers: 1, outputDir: 'node_modules/.cache/playwright-axe',
  use: { baseURL: 'http://127.0.0.1:${PORT}', browserName: 'chromium', trace: 'off' },
  webServer: { command: 'npm run dev -- --port ${PORT} --strictPort', url: 'http://127.0.0.1:${PORT}', reuseExistingServer: false },
});
EOC
export AXE_OUT="${AXE_OUT:-$PWD/node_modules/.cache/axe.jsonl}"
rm -f "$AXE_OUT"
npx playwright test --config pw-axe.config.ts "$@" || true
rm -rf tests/review-tmp pw-axe.config.ts
echo "axe results: $AXE_OUT"
