// SPDX-License-Identifier: AGPL-3.0-only
// PIN-BUNDLE-6 review: differential test of secrets.ts against the Go rules (internal/configstore/secrets.go).
// The backend repository writes the set of strings its ScanSQL mode rejects (TestPin6DifferentialCorpus,
// DBM_DIFF_OUT=<file>); this test asserts backend-rejected is a subset of client-rejected. Run with
// DBM_DIFF_CORPUS=<file> npx vitest run src/lib/features/config-store/pin6.differential.test.ts. Skipped without it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { looksSecret } from './secrets';

// The corpus is committed (backend TestPin6DifferentialCorpus output); DBM_DIFF_CORPUS overrides it.
const corpus =
  process.env.DBM_DIFF_CORPUS ?? 'src/lib/features/config-store/differential/backend-rejected.json';
describe('client secret rules cover the backend rules', () => {
  // DEFECT (Low, hardening): about 2 % of the mutation corpus is missed (digit/dot/plus/minus before a URL scheme, JS-only
  // whitespace such as NBSP/VT/U+2028 inside credentials, U+1D0A/U+029C missing from the confusables table).
  it('every string the backend rejects is rejected by the client (differences are listed)', () => {
    const strings = JSON.parse(readFileSync(corpus!, 'utf8')) as string[];
    const missed = strings.filter((s) => !looksSecret(s));
    const sample = missed
      .slice(0, 40)
      .map((s) =>
        JSON.stringify(s).replace(/[^\x20-\x7e]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16)}`),
      );
    console.log(`backend rejects ${strings.length}, client misses ${missed.length}`);
    console.log(sample.join('\n'));
    expect(missed).toEqual([]);
  });
});

describe('ReDoS on 1 MiB inputs', () => {
  const MiB = 1024 * 1024;
  const cases: [string, string][] = [
    ['a run', 'a'.repeat(MiB)],
    ['x: pairs', 'x:'.repeat(MiB / 2)],
    ['scheme run then @', 'a'.repeat(MiB - 1) + '@'],
    ['colon dsn', ':'.repeat(MiB) + '@tcp('],
    ['user:pw no @', 'u:' + 'p'.repeat(MiB)],
    ['scheme://u: many', 'ab://' + 'u:'.repeat(MiB / 2) + '@'],
    ['scheme.. no ://', 'a.b+c-'.repeat(MiB / 6) + ':/'],
    ['://:: with @', '://:'.repeat(MiB / 4) + '@'],
    ['curl and spaces', 'curl ' + ' -u'.repeat(MiB / 3)],
    ['curl and spaces 2', 'curl' + ' '.repeat(MiB) + 'x'],
    ['http then -u: ', 'http ' + '-u a'.repeat(MiB / 4)],
    ['password space runs', 'password' + ' '.repeat(MiB)],
    ['pass= no value', 'pass=' + ','.repeat(MiB)],
    ['bearer spaces', 'bearer ' + 'A'.repeat(MiB)],
    ['eyJ dots', 'eyJ' + 'A'.repeat(8) + '.' + 'B'.repeat(MiB)],
    ['eyJ chain', 'eyJAAAAAAAA.'.repeat(MiB / 12)],
    ['basic', 'basic ' + 'A'.repeat(7) + ' '.repeat(MiB)],
    ['dollar', '$' + 'a'.repeat(MiB)],
    ['dollar tags', '$a'.repeat(MiB / 2)],
    ['key spaces', 'key' + ' '.repeat(MiB)],
    ['pragma', 'pragma' + ' '.repeat(MiB) + 'x'],
    ['pragma w. dots', 'pragma ' + 'a . '.repeat(MiB / 4)],
    ['encryption', 'encryption' + ' '.repeat(MiB)],
    ['user spaces', 'user' + ' '.repeat(MiB)],
    ['private spaces', 'private' + ' '.repeat(MiB)],
    ['long run alnum no digits', 'abcdefghij'.repeat(MiB / 10)],
    ['many 31-runs', ('a'.repeat(31) + '!').repeat(MiB / 32)],
    ['folded: fullwidth', 'ａ'.repeat(MiB / 2)],
    ['folded: combining', 'a\u0301'.repeat(MiB / 2)],
    ['folded: cyrillic', 'а'.repeat(MiB)],
    ['a@ many', 'a@'.repeat(MiB / 2)],
    ['@ and colons', 'a:b@'.repeat(MiB / 4)],
    ['nonlinear candidate: x://', 'x://' + 'a:'.repeat(MiB / 2) + '/'],
  ];
  // DEFECT (Low): the DSN rule is quadratic ('a'*30 + ':' repeated, then '@'): 0.47 s at 100 000 chars (MAX_SQL), 1.4 s at 256 KiB,
  // 19 s at 1 MiB. Callers cap SQL at 100 000 characters first, so this is a freeze of at most about half a second, not a hang.
  it('the DSN rule scales linearly (256 KiB of a:b:c: pairs followed by @)', () => {
    const text = ('a'.repeat(30) + ':').repeat(Math.floor((256 * 1024) / 31)) + '@';
    const started = performance.now();
    looksSecret(text);
    expect(performance.now() - started).toBeLessThan(300);
  });
  it.each(cases)('%s stays fast', (_name, text) => {
    expect(text.length).toBeLessThanOrEqual(MiB + 64);
    const started = performance.now();
    looksSecret(text);
    const ms = performance.now() - started;
    expect(ms).toBeLessThan(1500);
  });
});
