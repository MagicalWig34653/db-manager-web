// SPDX-License-Identifier: AGPL-3.0-only
// Completion check for export streams (EXPORT-API.md: "Schlussmarke prüfen"). Browsers cannot read
// HTTP trailers, so the body itself must end with the format's closing marker:
//   SQL:  last line "-- DBMANAGER EXPORT COMPLETE"
//   JSON: balanced document whose last member is "complete":true
//   CSV:  last record is the control record ("complete" in the first field, other fields empty)
// The verifier works on the decoded (decompressed) bytes in constant memory.
export type ExportFormat = 'sql' | 'csv' | 'excel-csv' | 'json';

export interface Verdict {
  complete: boolean;
  /** Why the stream is not accepted; a stable code for the UI, not a user text. */
  reason?:
    'empty' | 'no_marker' | 'unbalanced' | 'open_string' | 'open_record' | 'no_control_record';
}

const TAIL = 96;
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
  private lastRecord: { bytes: number[]; overflow: boolean } | null = null;

  constructor(private format: ExportFormat) {}

  /** Number of decoded bytes seen so far. */
  get bytes(): number {
    return this.total;
  }

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    this.total += chunk.length;
    if (chunk.length >= TAIL) this.tail = chunk.slice(chunk.length - TAIL);
    else {
      const keep = Math.min(this.tail.length, TAIL - chunk.length);
      const merged = new Uint8Array(keep + chunk.length);
      merged.set(this.tail.subarray(this.tail.length - keep), 0);
      merged.set(chunk, keep);
      this.tail = merged;
    }
    if (this.format === 'json') this.scanJson(chunk);
    else if (this.format !== 'sql') this.scanCsv(chunk);
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
      if (!this.inQuotes && byte === NL) {
        // Record ends; a CR before the LF is part of the line ending, not of the record.
        if (this.record[this.record.length - 1] === CR) this.record.pop();
        this.lastRecord = { bytes: this.record, overflow: this.recordOverflow };
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
    return this.finishCsv();
  }

  private text(): string {
    return decoder.decode(this.tail);
  }

  private finishSql(): Verdict {
    const text = this.text().replace(/\r\n/g, '\n');
    const full = this.total <= TAIL;
    const marker = `${SQL_MARKER}\n`;
    if (text.endsWith(`\n${marker}`) || (full && text === marker)) return { complete: true };
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
    const control = /^"'?complete"(,"'?")*$/;
    if (!control.test(line)) return { complete: false, reason: 'no_control_record' };
    return { complete: true };
  }
}
