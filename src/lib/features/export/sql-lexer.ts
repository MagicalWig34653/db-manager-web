// SPDX-License-Identifier: AGPL-3.0-only
// Constant-memory SQL lexer for the export completion check (EXPORT-FORMAT.md: "Ein Vorkommen im
// Dateninhalt ist kein Abschluss"). SQLite and PostgreSQL write text with raw line breaks inside
// quoted literals, so a cell may contain "...;\n-- DBMANAGER EXPORT COMPLETE\n". The marker only
// counts when it is a real line comment: outside string literals, quoted identifiers and block
// comments, starting its own line after a finished statement, and the very last thing in the stream.
//
// Handled lexis: '...' with '' doubling, E'...' with backslash escapes (PostgreSQL), "..." and `...`
// identifiers with doubling, [...] identifiers (SQLite copies the stored CREATE statement verbatim, and a name such as
// [o'k] contains a quote; ']' closes, there is no escape; '[' directly after a word, ']' or ')' is an array
// subscript/type like text[] and stays plain code), -- line comments, /* */ block comments (nested, PostgreSQL).
// Not handled on purpose: PostgreSQL dollar quotes ($$...$$) and MySQL backslash escapes; the backend emits neither
// (text goes out as quoted literals, E-strings or CONVERT(X'..')).

const NL = 0x0a;
const QUOTE_S = 0x27;
const QUOTE_D = 0x22;
const BACKTICK = 0x60;
const BACKSLASH = 0x5c;
const DASH = 0x2d;
const SLASH = 0x2f;
const STAR = 0x2a;
const SEMICOLON = 0x3b;
const MARKER = '-- DBMANAGER EXPORT COMPLETE';
const MARKER_BYTES = new TextEncoder().encode(MARKER);

type State = 'code' | 'bracket' | 'string' | 'estring' | 'ident' | 'backtick' | 'line' | 'block';

export class SqlLexer {
  private state: State = 'code';
  /** A closing quote was seen; a second quote right after it is a doubled quote (still inside). */
  private quotePending = false;
  private backslash = false;
  private dash = false;
  private slash = false;
  private star = false;
  private depth = 0;
  private prev = 0;
  private prev2 = 0;
  // Line comment bookkeeping (code state only).
  private lineHasCode = false;
  private lastCode = 0;
  private comment: number[] = [];
  private commentOverflow = false;
  private commentStartsLine = false;
  private commentAfterStatement = false;
  /** Last finished line comment is the final element of the stream so far. */
  private endsWithComment = false;
  private seenAny = false;

  push(chunk: Uint8Array): void {
    for (const byte of chunk) {
      this.seenAny = true;
      this.step(byte);
      this.prev2 = this.prev;
      this.prev = byte;
    }
  }

  /** True when the stream so far ends with a genuine closing marker line comment. */
  get complete(): boolean {
    if (!this.seenAny || this.state !== 'code' || this.quotePending || !this.endsWithComment)
      return false;
    if (!this.commentStartsLine || !this.commentAfterStatement || this.commentOverflow)
      return false;
    if (this.comment.length !== MARKER_BYTES.length) return false;
    return MARKER_BYTES.every((value, index) => this.comment[index] === value);
  }

  private step(byte: number): void {
    switch (this.state) {
      case 'code':
        this.code(byte);
        return;
      case 'string':
      case 'ident':
      case 'backtick':
        this.quoted(byte);
        return;
      case 'estring':
        this.escapedString(byte);
        return;
      case 'bracket':
        if (byte === 0x5d) this.state = 'code';
        return;
      case 'line':
        if (byte === NL) {
          if (this.comment[this.comment.length - 1] === 0x0d) this.comment.pop();
          this.state = 'code';
          this.lineHasCode = false;
          this.endsWithComment = true;
        } else if (this.comment.length < 64) {
          this.comment.push(byte);
        } else this.commentOverflow = true;
        return;
      case 'block':
        this.blockComment(byte);
        return;
    }
  }

  private code(byte: number): void {
    // A pending quote close (string ended right before this byte) is handled in `quoted`.
    if (this.dash) {
      this.dash = false;
      if (byte === DASH) {
        this.state = 'line';
        this.comment = [DASH, DASH];
        this.commentOverflow = false;
        this.commentStartsLine = !this.lineHasCodeBeforeDash;
        this.commentAfterStatement = this.lastCodeBeforeDash === SEMICOLON;
        this.endsWithComment = false;
        return;
      }
      // The lone dash was code.
      this.markCode(DASH);
    }
    if (this.slash) {
      this.slash = false;
      if (byte === STAR) {
        this.state = 'block';
        this.depth = 1;
        this.star = false;
        this.slashInBlock = false;
        return;
      }
      this.markCode(SLASH);
    }
    if (byte === DASH) {
      this.lineHasCodeBeforeDash = this.lineHasCode;
      this.lastCodeBeforeDash = this.lastCode;
      this.dash = true;
      return;
    }
    if (byte === SLASH) {
      this.slash = true;
      return;
    }
    if (byte === NL) {
      this.lineHasCode = false;
      return;
    }
    if (byte === 0x20 || byte === 0x09 || byte === 0x0d) return;
    this.markCode(byte);
    if (byte === QUOTE_S) {
      const prefix = this.prev === 0x45 || this.prev === 0x65; // E'...'
      const attached = !isWord(this.prev2);
      this.state = prefix && attached ? 'estring' : 'string';
      this.quotePending = false;
      this.backslash = false;
    } else if (byte === QUOTE_D) {
      this.state = 'ident';
      this.quotePending = false;
    } else if (byte === 0x5b && !isWord(this.prev) && this.prev !== 0x5d && this.prev !== 0x29) {
      this.state = 'bracket';
    } else if (byte === BACKTICK) {
      this.state = 'backtick';
      this.quotePending = false;
    }
  }

  private lineHasCodeBeforeDash = false;
  private lastCodeBeforeDash = 0;
  private slashInBlock = false;

  private markCode(byte: number): void {
    this.lineHasCode = true;
    this.lastCode = byte;
    this.endsWithComment = false;
  }

  private closer(): number {
    return this.state === 'string' ? QUOTE_S : this.state === 'ident' ? QUOTE_D : BACKTICK;
  }

  private quoted(byte: number): void {
    if (this.quotePending) {
      this.quotePending = false;
      if (byte === this.closer()) return; // doubled quote, still inside
      this.state = 'code'; // the literal ended before this byte
      this.code(byte);
      return;
    }
    if (byte === this.closer()) this.quotePending = true;
  }

  private escapedString(byte: number): void {
    if (this.quotePending) {
      this.quotePending = false;
      if (byte === QUOTE_S) return;
      this.state = 'code';
      this.code(byte);
      return;
    }
    if (this.backslash) {
      this.backslash = false;
      return;
    }
    if (byte === BACKSLASH) this.backslash = true;
    else if (byte === QUOTE_S) this.quotePending = true;
  }

  private blockComment(byte: number): void {
    if (this.star && byte === SLASH) {
      this.star = false;
      this.slashInBlock = false;
      if (--this.depth === 0) this.state = 'code';
      return;
    }
    if (this.slashInBlock && byte === STAR) {
      this.slashInBlock = false;
      this.star = false;
      this.depth++;
      return;
    }
    this.star = byte === STAR;
    this.slashInBlock = byte === SLASH;
  }
}

function isWord(byte: number): boolean {
  return (
    (byte >= 0x30 && byte <= 0x39) ||
    (byte >= 0x41 && byte <= 0x5a) ||
    (byte >= 0x61 && byte <= 0x7a) ||
    byte === 0x5f ||
    byte >= 0x80
  );
}
