// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { compile, find, matchesFully, replaceAll, REGEX_LIMITS } from './regex';

const rep = (pattern: string, replacement: string, text: string, flags = '') => {
  const r = replaceAll(pattern, flags, replacement, text);
  return r.ok ? r.value : `ERR:${r.failure}`;
};

describe('safe regex engine: behaviour', () => {
  it('replaces literals, classes, groups and expands $1, $& and $$', () => {
    expect(rep('a', 'b', 'banana')).toBe('bbnbnb');
    expect(rep('[0-9]+', '#', 'a12b345')).toBe('a#b#');
    expect(rep('(\\w+)@(\\w+)', '$2 at $1', 'bob@host')).toBe('host at bob');
    expect(rep('o', '[$&]', 'foo')).toBe('f[o][o]');
    expect(rep('o', '$$', 'foo')).toBe('f$$');
    expect(rep('x', '$9', 'axb')).toBe('ab');
  });
  it('handles quantified groups', () => {
    expect(rep('(?:ab|c)+', 'X', 'abcabd c')).toBe('Xd X');
    expect(rep('(a|ab)(c|bcd)(d*)', '[$1|$2|$3]', 'abcd')).toBe('[a|bcd|]');
    expect(rep('(a+)+', '<$1>', 'aa b')).toBe('<aa> b');
  });
  it('handles anchors, alternation, quantifier bounds, lazy and non-capturing groups', () => {
    expect(rep('^a', 'X', 'aaa')).toBe('Xaa');
    expect(rep('a$', 'X', 'aaa')).toBe('aaX');
    expect(rep('cat|dog', 'pet', 'cat dog bird')).toBe('pet pet bird');
    expect(rep('a{2,3}', 'X', 'aaaaaaa')).toBe('XXa');
    expect(rep('a+?', 'X', 'aaa')).toBe('XXX');
    expect(rep('(?:ab)+', 'X', 'ababab-ab')).toBe('X-X');
    expect(rep('\\bfoo\\b', 'X', 'foo food foo')).toBe('X food X');
    expect(rep('[^a-c]', '.', 'abcdef')).toBe('abc...');
    expect(rep('A', 'x', 'aAa', 'i')).toBe('xxx');
  });
  it('advances over empty matches and works on code points', () => {
    expect(rep('x*', '-', 'abc')).toBe('-a-b-c-');
    expect(rep('.', '*', '😀a')).toBe('**');
  });
  it('rejects unsupported constructs instead of guessing', () => {
    for (const p of [
      '(a)\\1',
      '(?=a)',
      '(?<n>a)',
      '(?!a)',
      '\\p{L}',
      '[[:alpha:]]',
      '(',
      ')',
      'a**',
      '*a',
      'a{3,2}',
    ])
      expect(compile(p).ok, p).toBe(false);
    expect(compile('').ok).toBe(false);
    expect(compile('a'.repeat(REGEX_LIMITS.pattern + 1)).ok).toBe(false);
    expect(compile('a', 'g').ok).toBe(false);
    expect(compile('a{101}').ok).toBe(false);
    expect(compile('(((((((((((a)))))))))))').ok).toBe(false); // more than 9 groups
  });
  it('matchesFully validates the whole value', () => {
    expect(matchesFully('[a-z]+', 'abc')).toEqual({ ok: true, value: true });
    expect(matchesFully('[a-z]+', 'abc1')).toEqual({ ok: true, value: false });
    expect(matchesFully('a|ab', 'ab')).toEqual({ ok: true, value: true });
  });
});

describe('safe regex engine: hostile patterns and values', () => {
  const evil: [string, string][] = [
    ['(a+)+$', 'a'.repeat(5000) + '!'],
    ['(a|a)*b', 'a'.repeat(5000)],
    ['(a*)*b', 'a'.repeat(5000)],
    ['(.*a){20}', 'a'.repeat(50) + 'b'],
    ['(x+x+)+y', 'x'.repeat(5000)],
    ['^(([a-z])+.)+[A-Z]([a-z])+$', 'a'.repeat(5000) + '!'],
  ];
  for (const [pattern, text] of evil)
    it(`finishes ${pattern} quickly and deterministically`, () => {
      const started = Date.now();
      const first = replaceAll(pattern, '', '-', text);
      expect(Date.now() - started).toBeLessThan(3000);
      expect(replaceAll(pattern, '', '-', text)).toEqual(first);
    });
  it('stops at the step budget instead of running on', () => {
    const r = replaceAll('(?:a|b|c|d|e){0,100}z', '', 'x', 'abcde'.repeat(2000));
    expect(r.ok === false ? r.failure : 'ok').toBe('budget_exceeded');
  });
  it('refuses long input and long replacements, caps matches and output', () => {
    expect(rep('a', 'b', 'a'.repeat(REGEX_LIMITS.input + 1))).toBe('ERR:input_too_long');
    expect(rep('a', 'b'.repeat(REGEX_LIMITS.replacement + 1), 'a')).toBe(
      'ERR:replacement_too_long',
    );
    expect(rep('a', 'bb', 'a'.repeat(5000))).toBe('bb'.repeat(1000) + 'a'.repeat(4000));
    expect(replaceAll('a', '', 'z'.repeat(200), 'a'.repeat(900)).ok).toBe(false);
  });
  it('treats the replacement and the input as plain text (no pattern syntax leaks)', () => {
    expect(rep('a', '<img src=x onerror=alert(1)>', 'a')).toBe('<img src=x onerror=alert(1)>');
    expect(rep('.', '\\1', 'a')).toBe('\\1');
  });
});

describe('safe regex engine: agrees with the native engine on the supported subset', () => {
  let seed = 12345;
  const rnd = (n: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % n;
  };
  const atoms = ['a', 'b', 'c', '.', '[ab]', '[^a]', '\\d', '\\w', '1', ' '];
  const gen = (depth: number): string => {
    const parts: string[] = [];
    for (let i = 0, n = 1 + rnd(3); i < n; i++) {
      let part: string;
      const k = rnd(depth > 0 ? 6 : 4);
      if (k === 4) part = `(${gen(depth - 1)})`;
      else if (k === 5) part = `(?:${gen(depth - 1)}|${gen(depth - 1)})`;
      else part = atoms[rnd(atoms.length)];
      // Quantified groups can match empty; ECMAScript rejects empty iterations, this engine (like RE2) does not.
      const q = k >= 4 ? '' : ['', '', '*', '+', '?', '{1,2}', '*?', '+?'][rnd(8)];
      parts.push(part + q);
    }
    return parts.join('');
  };
  const inputs = ['', 'a', 'ab', 'abc', 'aabbcc 11', 'cab ba1', 'bbb', 'a1 b2 c3'];
  it('finds the same leftmost-first span for 1500 generated patterns', () => {
    let compared = 0;
    for (let i = 0; i < 1500; i++) {
      const pattern = gen(2);
      let native: RegExp;
      try {
        native = new RegExp(pattern);
      } catch {
        continue;
      }
      const compiled = compile(pattern);
      expect(compiled.ok, pattern).toBe(true);
      if (!compiled.ok) continue;
      for (const input of inputs) {
        const mine = find(compiled.program, input);
        const theirs = native.exec(input);
        expect(mine.ok).toBe(true);
        if (!mine.ok) continue;
        const got = mine.match ? [mine.match[0], mine.match[1]] : null;
        const want = theirs ? [theirs.index, theirs.index + theirs[0].length] : null;
        expect(got, `/${pattern}/ on ${JSON.stringify(input)}`).toEqual(want);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(5000);
  });
});
