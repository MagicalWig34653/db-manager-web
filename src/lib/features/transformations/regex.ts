// SPDX-License-Identifier: AGPL-3.0-only
// Linear-time regular expressions for display transformations (W-P22). The browser's own RegExp backtracks and can be
// driven into exponential time by a hostile pattern or value (ReDoS), and it cannot be interrupted. This engine is a
// Thompson/Pike VM: work is bounded by (input length x program size) and additionally by a fixed step budget, with no
// clock involved. It supports a deliberate subset: literals, `.`, classes, `\d \w \s \b` (and negations), `^ $`,
// groups (capturing and `(?:`), alternation, `* + ? {m,n}` (greedy or lazy). Backreferences and look-around are rejected.

export const REGEX_LIMITS = {
  pattern: 200,
  replacement: 200,
  input: 10_000,
  program: 2_000,
  captures: 9,
  repeat: 100,
  matches: 1_000,
  output: 100_000,
  /** Total VM steps (one thread advancing one instruction) per operation. */
  steps: 5_000_000,
} as const;

export type RegexFailure =
  | 'pattern_empty'
  | 'pattern_too_long'
  | 'pattern_invalid'
  | 'pattern_unsupported'
  | 'pattern_too_complex'
  | 'input_too_long'
  | 'budget_exceeded'
  | 'replacement_too_long'
  | 'output_too_long';

class RegexError extends Error {
  constructor(readonly failure: RegexFailure) {
    super(failure);
  }
}

type Range = readonly [number, number];
type Node =
  | { t: 'char'; c: number }
  | { t: 'any' }
  | { t: 'set'; ranges: Range[]; neg: boolean }
  | { t: 'bol' }
  | { t: 'eol' }
  | { t: 'wordb'; neg: boolean }
  | { t: 'group'; index: number; node: Node }
  | { t: 'cat'; nodes: Node[] }
  | { t: 'alt'; nodes: Node[] }
  | { t: 'rep'; node: Node; min: number; max: number; greedy: boolean };

const DIGIT: Range[] = [[48, 57]];
const WORD: Range[] = [
  [48, 57],
  [65, 90],
  [95, 95],
  [97, 122],
];
const SPACE: Range[] = [
  [9, 13],
  [32, 32],
  [160, 160],
  [0x2028, 0x2029],
  [0xfeff, 0xfeff],
];
const SYNTAX = new Set('^$\\.*+?()[]{}|/-'.split('').map((c) => c.charCodeAt(0)));

function complement(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const result: Range[] = [];
  let next = 0;
  for (const [lo, hi] of sorted) {
    if (lo > next) result.push([next, lo - 1]);
    next = Math.max(next, hi + 1);
  }
  if (next <= 0x10ffff) result.push([next, 0x10ffff]);
  return result;
}

class Parser {
  private pos = 0;
  groups = 0;
  constructor(private src: number[]) {}

  parse(): Node {
    const node = this.alt();
    if (this.pos < this.src.length) throw new RegexError('pattern_invalid'); // unmatched ")"
    return node;
  }
  private peek = () => this.src[this.pos];
  private eat(ch: string) {
    if (this.src[this.pos] === ch.charCodeAt(0)) {
      this.pos++;
      return true;
    }
    return false;
  }
  private alt(): Node {
    const nodes = [this.cat()];
    while (this.eat('|')) nodes.push(this.cat());
    return nodes.length === 1 ? nodes[0] : { t: 'alt', nodes };
  }
  private cat(): Node {
    const nodes: Node[] = [];
    while (this.pos < this.src.length && this.peek() !== 124 && this.peek() !== 41) {
      nodes.push(this.quantified());
    }
    return { t: 'cat', nodes };
  }
  private quantified(): Node {
    const node = this.atom();
    const c = this.peek();
    let min: number, max: number;
    if (c === 42) ((min = 0), (max = Infinity), this.pos++);
    else if (c === 43) ((min = 1), (max = Infinity), this.pos++);
    else if (c === 63) ((min = 0), (max = 1), this.pos++);
    else if (c === 123) {
      const bounds = this.braces();
      if (!bounds) return node; // a lone "{" is a literal
      [min, max] = bounds;
    } else return node;
    const greedy = !this.eat('?');
    if (node.t === 'bol' || node.t === 'eol' || node.t === 'wordb')
      throw new RegexError('pattern_invalid');
    const next = this.peek();
    // "a**", "a+*", "a{2}{3}": stacked quantifiers are an error, as in the native engine
    if (next === 42 || next === 43 || next === 63) throw new RegexError('pattern_invalid');
    if (next === 123) {
      const save = this.pos;
      const again = this.braces();
      this.pos = save;
      if (again) throw new RegexError('pattern_invalid');
    }
    return { t: 'rep', node, min, max, greedy };
  }
  private braces(): [number, number] | null {
    const save = this.pos;
    this.pos++;
    const num = (): number | null => {
      let digits = '';
      while (this.peek() >= 48 && this.peek() <= 57)
        digits += String.fromCharCode(this.src[this.pos++]);
      return digits === '' ? null : Number(digits.slice(0, 6));
    };
    const min = num();
    let max: number | null = min;
    if (min !== null && this.eat(',')) max = num() ?? Infinity;
    if (min === null || max === null || !this.eat('}')) {
      this.pos = save;
      return null;
    }
    if (min > REGEX_LIMITS.repeat || (max !== Infinity && max > REGEX_LIMITS.repeat) || max < min)
      throw new RegexError(max < min ? 'pattern_invalid' : 'pattern_too_complex');
    return [min, max];
  }
  private atom(): Node {
    const c = this.src[this.pos++];
    switch (c) {
      case 40: {
        // "("
        let index = -1;
        if (this.eat('?')) {
          if (!this.eat(':')) throw new RegexError('pattern_unsupported'); // look-around, named groups, flags
        } else {
          if (++this.groups > REGEX_LIMITS.captures) throw new RegexError('pattern_too_complex');
          index = this.groups;
        }
        const node = this.alt();
        if (!this.eat(')')) throw new RegexError('pattern_invalid');
        return { t: 'group', index, node };
      }
      case 91:
        return this.klass();
      case 46:
        return { t: 'any' };
      case 94:
        return { t: 'bol' };
      case 36:
        return { t: 'eol' };
      case 92:
        return this.escape(false);
      case 42:
      case 43:
      case 63:
        throw new RegexError('pattern_invalid'); // nothing to repeat
      default:
        return { t: 'char', c };
    }
  }
  private escape(inClass: boolean): Node {
    if (this.pos >= this.src.length) throw new RegexError('pattern_invalid');
    const c = this.src[this.pos++];
    const letter = String.fromCodePoint(c);
    switch (letter) {
      case 'd':
        return { t: 'set', ranges: DIGIT, neg: false };
      case 'D':
        return { t: 'set', ranges: DIGIT, neg: true };
      case 'w':
        return { t: 'set', ranges: WORD, neg: false };
      case 'W':
        return { t: 'set', ranges: WORD, neg: true };
      case 's':
        return { t: 'set', ranges: SPACE, neg: false };
      case 'S':
        return { t: 'set', ranges: SPACE, neg: true };
      case 'b':
        return inClass ? { t: 'char', c: 8 } : { t: 'wordb', neg: false };
      case 'B':
        if (inClass) throw new RegexError('pattern_invalid');
        return { t: 'wordb', neg: true };
      case 'n':
        return { t: 'char', c: 10 };
      case 'r':
        return { t: 'char', c: 13 };
      case 't':
        return { t: 'char', c: 9 };
      default:
        if (/[0-9]/.test(letter)) throw new RegexError('pattern_unsupported'); // back-reference
        if (/[A-Za-z]/.test(letter)) throw new RegexError('pattern_unsupported'); // \p, \k, \u, \x, ...
        return { t: 'char', c };
    }
  }
  private klass(): Node {
    const neg = this.eat('^');
    let ranges: Range[] = [];
    let first = true;
    for (;;) {
      if (this.pos >= this.src.length) throw new RegexError('pattern_invalid');
      if (this.peek() === 93 && !first) {
        this.pos++;
        break;
      }
      first = false;
      const lo = this.classAtom();
      if (Array.isArray(lo)) {
        ranges = ranges.concat(lo);
        continue;
      }
      if (this.peek() === 45 && this.src[this.pos + 1] !== 93 && this.pos + 1 < this.src.length) {
        this.pos++;
        const hi = this.classAtom();
        if (Array.isArray(hi) || (hi as number) < lo) throw new RegexError('pattern_invalid');
        ranges.push([lo, hi as number]);
      } else ranges.push([lo, lo]);
    }
    return { t: 'set', ranges, neg };
  }
  private classAtom(): number | Range[] {
    const c = this.src[this.pos++];
    if (c === 92) {
      const node = this.escape(true);
      if (node.t === 'char') return node.c;
      if (node.t === 'set') return node.neg ? complement(node.ranges) : [...node.ranges];
      throw new RegexError('pattern_invalid');
    }
    if (c === 91 && this.peek() === 58) throw new RegexError('pattern_unsupported'); // [[:alpha:]]
    return c;
  }
}

// ----- program -----

const enum Op {
  Char,
  Any,
  Set,
  Bol,
  Eol,
  WordB,
  Split,
  Jmp,
  Save,
  Match,
}
interface Inst {
  op: Op;
  c?: number;
  ranges?: Range[];
  neg?: boolean;
  x?: number;
  y?: number;
  n?: number;
}

export interface Program {
  insts: Inst[];
  groups: number;
  ignoreCase: boolean;
  multiline: boolean;
}
export type Compiled = { ok: true; program: Program } | { ok: false; failure: RegexFailure };

function emit(node: Node, out: Inst[]): void {
  const push = (inst: Inst) => {
    if (out.length >= REGEX_LIMITS.program) throw new RegexError('pattern_too_complex');
    return out.push(inst) - 1;
  };
  switch (node.t) {
    case 'char':
      push({ op: Op.Char, c: node.c });
      return;
    case 'any':
      push({ op: Op.Any });
      return;
    case 'set':
      push({ op: Op.Set, ranges: node.ranges, neg: node.neg });
      return;
    case 'bol':
      push({ op: Op.Bol });
      return;
    case 'eol':
      push({ op: Op.Eol });
      return;
    case 'wordb':
      push({ op: Op.WordB, neg: node.neg });
      return;
    case 'group':
      if (node.index > 0) push({ op: Op.Save, n: node.index * 2 });
      emit(node.node, out);
      if (node.index > 0) push({ op: Op.Save, n: node.index * 2 + 1 });
      return;
    case 'cat':
      for (const child of node.nodes) emit(child, out);
      return;
    case 'alt': {
      const jumps: number[] = [];
      node.nodes.forEach((child, i) => {
        if (i < node.nodes.length - 1) {
          const split = push({ op: Op.Split });
          out[split].x = out.length;
          emit(child, out);
          jumps.push(push({ op: Op.Jmp }));
          out[split].y = out.length;
        } else emit(child, out);
      });
      for (const j of jumps) out[j].x = out.length;
      return;
    }
    case 'rep': {
      for (let i = 0; i < node.min; i++) emit(node.node, out);
      if (node.max === Infinity) {
        // L: split body, end; body; jmp L
        const s = push({ op: Op.Split });
        const bodyStart = out.length;
        emit(node.node, out);
        push({ op: Op.Jmp, x: s });
        const end = out.length;
        out[s].x = node.greedy ? bodyStart : end;
        out[s].y = node.greedy ? end : bodyStart;
      } else {
        const splits: number[] = [];
        for (let i = node.min; i < node.max; i++) {
          const s = push({ op: Op.Split });
          splits.push(s);
          const bodyStart = out.length;
          emit(node.node, out);
          out[s].x = bodyStart; // patched below for the lazy case
        }
        const end = out.length;
        for (const s of splits) {
          const bodyStart = out[s].x as number;
          out[s].x = node.greedy ? bodyStart : end;
          out[s].y = node.greedy ? end : bodyStart;
        }
      }
      return;
    }
  }
}

/** Compiles `pattern`; flags `i` (ignore case) and `m` (multi-line anchors) are supported. */
export function compile(pattern: string, flags = ''): Compiled {
  try {
    if (pattern === '') throw new RegexError('pattern_empty');
    const points = Array.from(pattern, (ch) => ch.codePointAt(0) as number);
    if (points.length > REGEX_LIMITS.pattern) throw new RegexError('pattern_too_long');
    if (/[^im]/.test(flags)) throw new RegexError('pattern_unsupported');
    const parser = new Parser(points);
    const ast = parser.parse();
    const insts: Inst[] = [];
    emit(ast, insts);
    insts.push({ op: Op.Match });
    return {
      ok: true,
      program: {
        insts,
        groups: parser.groups,
        ignoreCase: flags.includes('i'),
        multiline: flags.includes('m'),
      },
    };
  } catch (cause) {
    if (cause instanceof RegexError) return { ok: false, failure: cause.failure };
    return { ok: false, failure: 'pattern_invalid' };
  }
}

// ----- matching -----

const fold = (c: number): number => {
  if (c < 128) return c >= 65 && c <= 90 ? c + 32 : c;
  const lower = String.fromCodePoint(c).toLowerCase();
  return Array.from(lower).length === 1 ? (lower.codePointAt(0) as number) : c;
};
const inRanges = (ranges: Range[], c: number) => {
  for (const [lo, hi] of ranges) if (c >= lo && c <= hi) return true;
  return false;
};
const isWord = (c: number | undefined) => c !== undefined && inRanges(WORD, c);

interface Thread {
  pc: number;
  caps: number[];
}

/** Result of one search: `caps[2k]`/`caps[2k+1]` are the start/end (code point index) of group k, -1 when unset. */
export type Match = number[];

class Budget {
  steps = 0;
  spend(n = 1) {
    this.steps += n;
    if (this.steps > REGEX_LIMITS.steps) throw new RegexError('budget_exceeded');
  }
}

function search(program: Program, input: number[], from: number, budget: Budget): Match | null {
  const { insts } = program;
  const ncap = (program.groups + 1) * 2;
  const folded = program.ignoreCase;
  let clist: Thread[] = [];
  let nlist: Thread[];
  const mark = new Int32Array(insts.length);
  let best: Match | null = null;

  const assertOk = (inst: Inst, pos: number) => {
    switch (inst.op) {
      case Op.Bol:
        return pos === 0 || (program.multiline && input[pos - 1] === 10);
      case Op.Eol:
        return pos === input.length || (program.multiline && input[pos] === 10);
      default: {
        const boundary = isWord(input[pos - 1]) !== isWord(input[pos]);
        return boundary !== !!inst.neg;
      }
    }
  };
  // Follows empty transitions in priority order; `list` receives the threads waiting on a character or a match.
  const add = (list: Thread[], pc0: number, pos: number, caps0: number[], gen: number) => {
    const stack: Thread[] = [{ pc: pc0, caps: caps0 }];
    while (stack.length) {
      const { pc, caps } = stack.pop() as Thread;
      if (mark[pc] === gen) continue;
      mark[pc] = gen;
      budget.spend();
      const inst = insts[pc];
      switch (inst.op) {
        case Op.Jmp:
          stack.push({ pc: inst.x as number, caps });
          break;
        case Op.Split:
          stack.push({ pc: inst.y as number, caps });
          stack.push({ pc: inst.x as number, caps });
          break;
        case Op.Save: {
          const copy = caps.slice();
          copy[inst.n as number] = pos;
          stack.push({ pc: pc + 1, caps: copy });
          break;
        }
        case Op.Bol:
        case Op.Eol:
        case Op.WordB:
          if (assertOk(inst, pos)) stack.push({ pc: pc + 1, caps });
          break;
        default:
          list.push({ pc, caps });
      }
    }
  };

  let counter = 1;
  let gen = counter;
  for (let pos = from; pos <= input.length; pos++) {
    // A new attempt starts here only while nothing has matched (leftmost semantics), with the lowest priority.
    if (!best) {
      const caps = new Array<number>(ncap).fill(-1);
      caps[0] = pos;
      add(clist, 0, pos, caps, gen);
    }
    if (clist.length === 0 && best) break;
    gen = ++counter;
    nlist = [];
    const c = input[pos];
    for (let i = 0; i < clist.length; i++) {
      const { pc, caps } = clist[i];
      budget.spend();
      const inst = insts[pc];
      if (inst.op === Op.Match) {
        const copy = caps.slice();
        copy[1] = pos;
        best = copy;
        break; // threads of lower priority are discarded
      }
      if (c === undefined) continue;
      let ok = false;
      if (inst.op === Op.Char) ok = folded ? fold(c) === fold(inst.c as number) : c === inst.c;
      else if (inst.op === Op.Any) ok = c !== 10 && c !== 13 && c !== 0x2028 && c !== 0x2029;
      else if (inst.op === Op.Set) {
        const ranges = inst.ranges as Range[];
        let hit = inRanges(ranges, c);
        if (!hit && folded) {
          const upper = String.fromCodePoint(c).toUpperCase();
          hit =
            inRanges(ranges, fold(c)) ||
            (Array.from(upper).length === 1 && inRanges(ranges, upper.codePointAt(0) as number));
        }
        ok = hit !== !!inst.neg;
      }
      if (ok) add(nlist, pc + 1, pos + 1, caps, gen);
    }
    clist = nlist;
  }
  return best;
}

function toPoints(text: string): number[] {
  return Array.from(text, (ch) => ch.codePointAt(0) as number);
}

export type FindResult = { ok: true; match: Match | null } | { ok: false; failure: RegexFailure };
/** First match of an already compiled program (or null). Input beyond the limit is refused, not truncated. */
export function find(program: Program, text: string, from = 0): FindResult {
  if (text.length > REGEX_LIMITS.input * 2) return { ok: false, failure: 'input_too_long' };
  const input = toPoints(text);
  if (input.length > REGEX_LIMITS.input) return { ok: false, failure: 'input_too_long' };
  try {
    return { ok: true, match: search(program, input, from, new Budget()) };
  } catch (cause) {
    if (cause instanceof RegexError) return { ok: false, failure: cause.failure };
    throw cause;
  }
}

/** True when the whole text is matched by the pattern (used by input validation). */
export function matchesFully(pattern: string, text: string, flags = ''): RegexResult<boolean> {
  const compiled = compile(`^(?:${pattern})$`, flags);
  if (!compiled.ok) return compiled;
  const found = find(compiled.program, text);
  return found.ok ? { ok: true, value: found.match !== null } : found;
}

export type RegexResult<T> = { ok: true; value: T } | { ok: false; failure: RegexFailure };

function expandTemplate(template: number[], input: number[], match: Match, out: number[]) {
  for (let i = 0; i < template.length; i++) {
    const c = template[i];
    const next = template[i + 1];
    if (c === 36 && next !== undefined) {
      // "$"
      if (next === 36) (out.push(36), i++);
      else if (next === 38) {
        for (let k = match[0]; k < match[1]; k++) out.push(input[k]);
        i++;
      } else if (next >= 49 && next <= 57) {
        const group = next - 48;
        const s = match[group * 2];
        const e = match[group * 2 + 1];
        if (s !== undefined && s >= 0 && e >= s) for (let k = s; k < e; k++) out.push(input[k]);
        i++;
      } else out.push(c);
    } else out.push(c);
  }
}

/**
 * Replaces every match (up to a limit) in `text`; `$1`..`$9`, `$&` and `$$` are expanded in the replacement. The text
 * is only for display and is never executed or interpreted as markup.
 */
export function replaceAll(
  pattern: string,
  flags: string,
  replacement: string,
  text: string,
): RegexResult<string> {
  const compiled = compile(pattern, flags);
  if (!compiled.ok) return compiled;
  if (replacement.length > REGEX_LIMITS.replacement)
    return { ok: false, failure: 'replacement_too_long' };
  if (text.length > REGEX_LIMITS.input * 2) return { ok: false, failure: 'input_too_long' };
  const input = toPoints(text);
  if (input.length > REGEX_LIMITS.input) return { ok: false, failure: 'input_too_long' };
  const template = toPoints(replacement);
  const out: number[] = [];
  const budget = new Budget();
  try {
    let pos = 0;
    let copied = 0;
    let count = 0;
    while (pos <= input.length && count < REGEX_LIMITS.matches) {
      const match = search(compiled.program, input, pos, budget);
      if (!match) break;
      for (let k = copied; k < match[0]; k++) out.push(input[k]);
      expandTemplate(template, input, match, out);
      if (out.length > REGEX_LIMITS.output) return { ok: false, failure: 'output_too_long' };
      count++;
      copied = match[1];
      if (match[1] === match[0]) {
        // empty match: copy one character and move on so the loop always advances
        if (match[0] < input.length) out.push(input[match[0]]);
        copied = match[0] + 1;
        pos = match[0] + 1;
      } else pos = match[1];
    }
    for (let k = copied; k < input.length; k++) out.push(input[k]);
    if (out.length > REGEX_LIMITS.output) return { ok: false, failure: 'output_too_long' };
    let text2 = '';
    for (let k = 0; k < out.length; k += 8192)
      text2 += String.fromCodePoint(...out.slice(k, k + 8192));
    return { ok: true, value: text2 };
  } catch (cause) {
    if (cause instanceof RegexError) return { ok: false, failure: cause.failure };
    throw cause;
  }
}
