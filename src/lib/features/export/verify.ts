// SPDX-License-Identifier: AGPL-3.0-only
// Completion check for export streams (EXPORT-API.md: "Schlussmarke prüfen"). Browsers cannot read
// HTTP trailers, so the body itself must end with the format's closing marker:
//   SQL:  last line "-- DBMANAGER EXPORT COMPLETE"
//   JSON: balanced document whose last member is "complete":true
//   CSV:  last record is the control record ("complete" in the first field, other fields empty)
//   Extended formats (API 0.21, EXTENDED-EXPORT-API.md): the exact closing structure of each format
//   (XML `</table>\n<complete>true</complete></export>\n`, YAML/JSON-lines `"complete":true}`, PHP
//   `),'complete'=>true);`, LaTeX/MediaWiki/Texy marker comment line). The backend escapes every data
//   value, so a cell can never produce these closing lines; they must be the very end of the stream.
// The verifier works on the decoded (decompressed) bytes in constant memory.
import { SqlLexer } from './sql-lexer';

export type ExportFormat =
  | 'sql'
  | 'csv'
  | 'excel-csv'
  | 'json'
  | 'xml'
  | 'yaml'
  | 'php-array'
  | 'latex'
  | 'latex-longtable'
  | 'mediawiki'
  | 'texy'
  | 'codegen';

/** Formats that are JSON documents or JSON lines and therefore get the string/bracket scan. */
const JSON_LIKE: ReadonlySet<ExportFormat> = new Set(['json', 'yaml', 'codegen']);
const CSV_LIKE: ReadonlySet<ExportFormat> = new Set(['csv', 'excel-csv']);
export const isCsvFormat = (format: ExportFormat) => CSV_LIKE.has(format);
export const defaultDelimiter = (format: ExportFormat) => (format === 'excel-csv' ? ';' : ',');

export interface Verdict {
  complete: boolean;
  /** Why the stream is not accepted; a stable code for the UI, not a user text. */
  reason?:
    | 'empty'
    | 'no_marker'
    | 'unbalanced'
    | 'open_string'
    | 'open_record'
    | 'no_control_record'
    | 'bad_head';
}

const TAIL = 96;
const HEAD = 64;
const LATEX_MARKER = '% DBMANAGER EXPORT COMPLETE';
const WIKI_MARKER = '<!-- DBMANAGER EXPORT COMPLETE -->';
const NL = 0x0a;
const CR = 0x0d;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const SQL_MARKER = '-- DBMANAGER EXPORT COMPLETE';
const decoder = new TextDecoder('utf-8');

export class CompletionVerifier {
  private total = 0;
  private tail = new Uint8Array(0);
  // JSON state
  private depth = 0;
  private inString = false;
  private escaped = false;
  private broken = false;
  // CSV state
  private inQuotes = false;
  private record: number[] = [];
  private recordOverflow = false;
  private lastRecord: { bytes: number[]; overflow: boolean; fields: number } | null = null;
  private fields = 1;
  private headerFields = 0;
  private headerOk = false;
  private recordCount = 0;
  private head = new Uint8Array(0);
  private sqlLexer = new SqlLexer();
  private delimiter: number;
  private delimiterText: string;

  /** `delimiter` is only used for CSV formats (the request's delimiter, or the format default). */
  constructor(
    private format: ExportFormat,
    delimiter?: string,
  ) {
    this.delimiterText = delimiter || defaultDelimiter(format);
    this.delimiter = this.delimiterText.charCodeAt(0);
  }

  /** Number of decoded bytes seen so far. */
  get bytes(): number {
    return this.total;
  }

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    if (this.head.length < HEAD) {
      const merged = new Uint8Array(Math.min(HEAD, this.head.length + chunk.length));
      merged.set(this.head, 0);
      merged.set(chunk.subarray(0, merged.length - this.head.length), this.head.length);
      this.head = merged;
    }
    this.total += chunk.length;
    if (chunk.length >= TAIL) this.tail = chunk.slice(chunk.length - TAIL);
    else {
      const keep = Math.min(this.tail.length, TAIL - chunk.length);
      const merged = new Uint8Array(keep + chunk.length);
      merged.set(this.tail.subarray(this.tail.length - keep), 0);
      merged.set(chunk, keep);
      this.tail = merged;
    }
    if (this.format === 'sql') this.sqlLexer.push(chunk);
    else if (JSON_LIKE.has(this.format)) this.scanJson(chunk);
    else if (CSV_LIKE.has(this.format)) this.scanCsv(chunk);
  }

  private scanJson(chunk: Uint8Array) {
    for (const byte of chunk) {
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (byte === BACKSLASH) this.escaped = true;
        else if (byte === QUOTE) this.inString = false;
        continue;
      }
      if (byte === QUOTE) this.inString = true;
      else if (byte === 0x7b || byte === 0x5b) this.depth++;
      else if (byte === 0x7d || byte === 0x5d) {
        this.depth--;
        if (this.depth < 0) this.broken = true;
      }
    }
  }

  private scanCsv(chunk: Uint8Array) {
    for (const byte of chunk) {
      if (byte === QUOTE) this.inQuotes = !this.inQuotes;
      else if (byte === this.delimiter && !this.inQuotes) this.fields++;
      if (!this.inQuotes && byte === NL) {
        // Record ends; a CR before the LF is part of the line ending, not of the record.
        if (this.record[this.record.length - 1] === CR) this.record.pop();
        this.lastRecord = {
          bytes: this.record,
          overflow: this.recordOverflow,
          fields: this.fields,
        };
        if (this.recordCount++ === 0) {
          this.headerFields = this.fields;
          // The stream profile starts with the control column "_record" (excel: apostrophe prefix).
          this.headerOk = /^"'?_record"/.test(decoder.decode(Uint8Array.from(this.record)));
        }
        this.fields = 1;
        this.record = [];
        this.recordOverflow = false;
        continue;
      }
      if (this.record.length < 512) this.record.push(byte);
      else this.recordOverflow = true;
    }
  }

  finish(): Verdict {
    if (this.total === 0) return { complete: false, reason: 'empty' };
    if (this.format === 'sql') return this.finishSql();
    if (this.format === 'json') return this.finishJson();
    if (CSV_LIKE.has(this.format)) return this.finishCsv();
    return this.finishExtended();
  }

  private text(): string {
    return decoder.decode(this.tail);
  }

  private finishSql(): Verdict {
    const text = this.text().replace(/\r\n/g, '\n');
    // The marker follows a finished statement (COMMIT; / SET ...;) and must be a real line comment: the lexer
    // rejects a marker line that sits inside a string literal, quoted identifier or block comment (a cell may
    // contain ";\n-- DBMANAGER EXPORT COMPLETE\n"), the tail check pins it to the very end of the stream.
    if (this.sqlLexer.complete && new RegExp(`;[ \\t]*\\n${SQL_MARKER}\\n$`).test(text))
      return { complete: true };
    return { complete: false, reason: 'no_marker' };
  }

  private finishJson(): Verdict {
    if (this.broken || this.depth !== 0) return { complete: false, reason: 'unbalanced' };
    if (this.inString) return { complete: false, reason: 'open_string' };
    if (!/,"complete":true\}\s*$/.test(this.text()))
      return { complete: false, reason: 'no_marker' };
    return { complete: true };
  }

  private finishCsv(): Verdict {
    if (this.inQuotes) return { complete: false, reason: 'open_record' };
    // The stream must end with a line ending; the unterminated rest would be a cut record.
    if (this.record.length > 0) return { complete: false, reason: 'open_record' };
    const last = this.lastRecord;
    if (!last || last.overflow) return { complete: false, reason: 'no_control_record' };
    const line = decoder.decode(Uint8Array.from(last.bytes));
    // Fields are always enclosed in quotes; the excel profile prefixes each value with an apostrophe.
    const separator = this.delimiterText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const control = new RegExp(`^"'?complete"(${separator}"'?")*$`);
    if (!control.test(line)) return { complete: false, reason: 'no_control_record' };
    // Same width as the header (the backend writes columns + 1 fields); data records start with "row".
    if (!this.headerOk || this.recordCount < 2 || last.fields !== this.headerFields)
      return { complete: false, reason: 'no_control_record' };
    return { complete: true };
  }

  /** XML, YAML, PHP array, LaTeX, MediaWiki, Texy and CodeGen text (API 0.21). */
  private finishExtended(): Verdict {
    const head = decoder.decode(this.head).replace(/^\uFEFF/, '');
    const text = this.text().replace(/\r\n/g, '\n');
    const ends = (pattern: RegExp): Verdict =>
      pattern.test(text) ? { complete: true } : { complete: false, reason: 'no_marker' };
    const headed = (pattern: RegExp, then: () => Verdict): Verdict =>
      pattern.test(head) ? then() : { complete: false, reason: 'bad_head' };
    const jsonShape = (): Verdict | null => {
      if (this.broken || this.depth !== 0) return { complete: false, reason: 'unbalanced' };
      if (this.inString) return { complete: false, reason: 'open_string' };
      return null;
    };
    switch (this.format) {
      case 'xml':
        return headed(/^<\?xml /, () => ends(/<\/table>\n<complete>true<\/complete><\/export>\n$/));
      case 'yaml':
        return headed(
          /^\{"format":"dbmanager-export"/,
          () => jsonShape() ?? ends(/\],"complete":true\}\n$/),
        );
      case 'codegen':
        return headed(
          /^\{"format":"dbmanager-codegen-text"/,
          () => jsonShape() ?? ends(/\n\{"complete":true\}\n$/),
        );
      case 'php-array':
        return headed(/^<\?php\nreturn array\(/, () => ends(/\),'complete'=>true\);\n$/));
      case 'latex':
        return ends(new RegExp(`\\\\end\\{tabular\\}\\n${LATEX_MARKER}\\n$`));
      case 'latex-longtable':
        return ends(new RegExp(`\\\\end\\{longtable\\}\\n${LATEX_MARKER}\\n$`));
      case 'mediawiki':
        return ends(new RegExp(`\\n\\|\\}\\n${WIKI_MARKER}\\n$`));
      case 'texy':
        return ends(new RegExp(`\\|\\n\\n?${WIKI_MARKER}\\n$`));
      default:
        return { complete: false, reason: 'no_marker' };
    }
  }
}
