// SPDX-License-Identifier: AGPL-3.0-only
// Independent review of web wave 2: adversarial checks on the completion verifier and on file names.
import { describe, expect, it } from 'vitest';
import { safeFilename as bulkFilename } from '../bulk/model';
import { CompletionVerifier, type ExportFormat } from './verify';
import { safeFilename } from './run';

const enc = (text: string) => new TextEncoder().encode(text);
function verdict(format: ExportFormat, text: string) {
  const verifier = new CompletionVerifier(format);
  verifier.push(enc(text));
  return verifier.finish();
}

describe('REVIEW F-2: SQL marker inside a multi-line text literal', () => {
  // SQLite and PostgreSQL export text with raw line breaks inside the literal (exportLiteral in the backend).
  // A cell that contains ";\n-- DBMANAGER EXPORT COMPLETE\n" followed by a cut right after that line looks complete.
  const cut = "INSERT INTO t VALUES ('x;\n-- DBMANAGER EXPORT COMPLETE\n";
  it('a stream cut inside such a literal must not be accepted', () => {
    expect(verdict('sql', cut).complete).toBe(false);
  });
  it('rejects the marker inside quoted identifiers, E-strings, block comments and doubled quotes', () => {
    const tail = ';\n-- DBMANAGER EXPORT COMPLETE\n';
    for (const head of [
      'SELECT "a',
      'SELECT `a',
      "INSERT INTO t VALUES (E'a\\'",
      "INSERT INTO t VALUES ('it''s",
      '/* c ',
      '/* a /* nested */ still open ',
    ])
      expect(verdict('sql', head + tail).complete, head).toBe(false);
  });
  it('accepts the marker after literals that merely contain comment-like text', () => {
    const end = ';\n-- DBMANAGER EXPORT COMPLETE\n';
    for (const body of [
      "INSERT INTO t VALUES ('a -- b /* c');",
      "INSERT INTO t VALUES ('it''s');",
      "INSERT INTO t VALUES (E'a\\'b');",
      'CREATE TABLE "a;\n-- x" (id int);',
      "/* header 'quote */ INSERT INTO t VALUES ('x'",
      "-- header: it's\nINSERT INTO t VALUES (1",
    ])
      expect(verdict('sql', body.replace(/;$/, '') + end).complete, body).toBe(true);
  });
  it('handles SQLite [bracket] identifiers that contain quotes (review: hostile DDL)', () => {
    const end = ';\n-- DBMANAGER EXPORT COMPLETE\n';
    // Valid dump: the quote inside [o'k] must not open a literal.
    expect(
      verdict(
        'sql',
        "CREATE TABLE IF NOT EXISTS [o'k] (id INTEGER, [a b] TEXT);\nINSERT INTO [o'k] VALUES (1, 'x'" +
          end,
      ).complete,
    ).toBe(true);
    // Cut stream inside a text literal after such DDL must still be rejected.
    expect(
      verdict('sql', "CREATE TABLE [o'k] (id);\nINSERT INTO t VALUES ('x" + end).complete,
    ).toBe(false);
    // Array types and subscripts are not bracket identifiers.
    expect(verdict('sql', 'CREATE TABLE t (a text[], b int[3]' + end).complete).toBe(true);
    // A marker line inside a bracket identifier is not an end.
    expect(verdict('sql', 'CREATE TABLE [a' + end).complete).toBe(false);
  });
  it('bracket identifiers survive every chunk size', () => {
    const text =
      "CREATE TABLE [o'k] (id);\nINSERT INTO [o'k] VALUES ('a''b');\n-- DBMANAGER EXPORT COMPLETE\n";
    for (let size = 1; size <= 9; size++) {
      const verifier = new CompletionVerifier('sql');
      const bytes = enc(text);
      for (let i = 0; i < bytes.length; i += size) verifier.push(bytes.subarray(i, i + size));
      expect(verifier.finish().complete, `chunk ${size}`).toBe(true);
    }
  });
  it('works across arbitrary chunk boundaries and CRLF', () => {
    const text =
      "-- h\r\nINSERT INTO t VALUES ('a''b;\n-- x');\r\n-- DBMANAGER EXPORT COMPLETE\r\n";
    for (let size = 1; size <= 7; size++) {
      const verifier = new CompletionVerifier('sql');
      const bytes = enc(text);
      for (let i = 0; i < bytes.length; i += size) verifier.push(bytes.subarray(i, i + size));
      expect(verifier.finish().complete, `chunk ${size}`).toBe(true);
    }
  });
  it('control: the real end is accepted and a plain unterminated literal is not', () => {
    expect(
      verdict('sql', "INSERT INTO t VALUES ('x');\n-- DBMANAGER EXPORT COMPLETE\n").complete,
    ).toBe(true);
    expect(
      verdict('sql', "INSERT INTO t VALUES ('x\n-- DBMANAGER EXPORT COMPLETE\n").complete,
    ).toBe(false);
  });
});

describe('hostile file names', () => {
  const hostile = [
    '../../etc/passwd',
    '..\\..\\windows\\system32\\evil.exe',
    'a‮exe.sql',
    'con.sql',
    'NUL',
    '<img src=x onerror=alert(1)>.sql',
    'x\0.sql',
    '.htaccess',
    'a'.repeat(5000) + '.sql.gz',
    '',
    '%2e%2e%2fevil',
    '..%5c..%5cevil',
  ];
  for (const name of hostile) {
    it(`Content-Disposition ${JSON.stringify(name).slice(0, 40)} is reduced to a harmless base name`, () => {
      const safe = safeFilename(`attachment; filename="${name}"`, 'export.sql');
      expect(safe).toMatch(/^[A-Za-z0-9._-]{1,150}$/);
      expect(safe).not.toMatch(/^\./);
      expect(safe).not.toContain('..');
      expect(safe).not.toMatch(/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i);
    });
    it(`filename* ${JSON.stringify(name).slice(0, 40)} likewise`, () => {
      const safe = safeFilename(
        `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        'export.sql',
      );
      expect(safe).toMatch(/^[A-Za-z0-9._-]{1,150}$/);
      expect(safe).not.toMatch(/^\./);
    });
  }
  it('file value download names never contain anything but identifier characters', () => {
    for (const table of ['../x', 'a b', '<script>', 'ü', '', '\0']) {
      for (const column of ['../../y', '"; rm -rf', '']) {
        expect(bulkFilename(table, column)).toMatch(
          /^[A-Za-z0-9_-]{1,40}-[A-Za-z0-9_-]{1,40}\.bin$/,
        );
      }
    }
  });
});
