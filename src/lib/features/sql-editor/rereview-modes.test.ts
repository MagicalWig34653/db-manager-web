// SPDX-License-Identifier: AGPL-3.0-only
// Server-mode divergence (MySQL NO_BACKSLASH_ESCAPES / ANSI_QUOTES, PG standard_conforming_strings=off is covered by E'').
// The lexer always assumes backslash escapes for MySQL. If it mis-pairs quotes AND the check still passes, a real literal
// would be re-spaced. Reports the number of statements where the formatted output changes literal bytes under
// NO_BACKSLASH_ESCAPES (independent scanner with backslash = plain character).
import { it, expect } from 'vitest';
import { formatSql } from './format';
import { rng, scan } from './rereview-corpus';

const ALPHA = ["'", "'", "'", '\\', '\\', ' ', ' ', '  ', 'a', 'b', ',', '\n', 'x'];
it.fails(
  'MySQL NO_BACKSLASH_ESCAPES: formatter must not change literal bytes (documented limitation if it does)',
  () => {
    const r = rng(7);
    const bad: string[] = [];
    let formatted = 0;
    for (let n = 0; n < 200000; n++) {
      let s = 'select ';
      const len = 3 + Math.floor(r() * 14);
      for (let k = 0; k < len; k++) s += ALPHA[Math.floor(r() * ALPHA.length)];
      const out = formatSql(s, 'mysql');
      if (out === null) continue;
      formatted++;
      const a = scan(s, 'mysql', true);
      const b = scan(out, 'mysql', true);
      const lit = (x: typeof a) =>
        x ? JSON.stringify(x.filter((y) => y.kind !== 'code').map((y) => y.text)) : 'null';
      if (lit(a) !== lit(b)) bad.push(JSON.stringify(s) + ' => ' + JSON.stringify(out));
    }
    console.log(
      'NO_BACKSLASH_ESCAPES: formatted',
      formatted,
      'literal-changing',
      bad.length,
      '\n' + bad.slice(0, 10).join('\n'),
    );
    expect(bad).toEqual([]);
  },
);
