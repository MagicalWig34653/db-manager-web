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
  it.fails(
    'a stream cut inside such a literal must not be accepted (current verifier accepts it)',
    () => {
      expect(verdict('sql', cut).complete).toBe(false);
    },
  );
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
