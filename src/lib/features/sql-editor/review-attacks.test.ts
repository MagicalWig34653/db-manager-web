// SPDX-License-Identifier: AGPL-3.0-only
// Independent review (web wave): credential statements must never reach the opt-in SQL history.
import { describe, expect, it } from 'vitest';
import { safeSql } from './storage.svelte';

const credentialStatements = [
  "ALTER USER app IDENTIFIED BY 'hunter2'",
  "CREATE USER app IDENTIFIED WITH mysql_native_password BY 'hunter2'",
  "ALTER ROLE app WITH PASSWORD 'hunter2'",
  "ALTER ROLE app PASSWORD\n'hunter2'",
  "SET PASSWORD = 'hunter2'",
  "SET PASSWORD FOR 'app'@'%' = PASSWORD('hunter2')",
  "SET PASSWORD FOR app = 'hunter2'",
  "ALTER ROLE app WITH ENCRYPTED PASSWORD E'hunter2'",
  'ALTER ROLE app WITH PASSWORD $$hunter2$$',
  'ALTER ROLE app WITH PASSWORD $tag$hunter2$tag$',
  "CREATE USER app IDENTIFIED VIA mysql_native_password USING PASSWORD('hunter2')",
  "CREATE USER app IDENTIFIED VIA mysql_native_password USING 'hunter2'",
  "ALTER USER app IDENTIFIED BY\n'hunter2'",
  "CREATE ROLE app LOGIN PASSWORD U&'hunter2'",
  "CREATE SERVER s FOREIGN DATA WRAPPER postgres_fdw OPTIONS (password 'hunter2')",
  "CREATE USER MAPPING FOR app SERVER s OPTIONS (user 'a', password 'hunter2')",
  "SELECT 1 /* password */ ; ALTER USER x PASSWORD /* c */ 'hunter2'",
  "ALTER USER app PASSWORD/**/'hunter2'",
  "ALTER USER app PASSWORD 'hunter2'",
  "CHANGE REPLICATION SOURCE TO SOURCE_PASSWORD='hunter2'",
  "CHANGE MASTER TO MASTER_PASSWORD='hunter2'",
  "CREATE SUBSCRIPTION s CONNECTION 'host=h user=u password=hunter2' PUBLICATION p",
  "SELECT dblink_connect('host=h user=u password=hunter2')",
  "ATTACH DATABASE 'x' AS y KEY 'hunter2'",
  "PRAGMA key = 'hunter2'",
  "PRAGMA key='hunter2'",
];

const benignStatements = [
  'SELECT * FROM orders WHERE id = 1',
  'CREATE TABLE t (id integer PRIMARY KEY, owner_id integer, FOREIGN KEY (owner_id) REFERENCES o(id))',
  "INSERT INTO notes (body) VALUES ('hello')",
  'UPDATE orders SET total = total + $1 WHERE id = $2',
  'SELECT count(*) FROM pg_catalog.pg_tables',
];

describe('review: credential statements are not accepted for the history', () => {
  for (const sql of credentialStatements) {
    it(JSON.stringify(sql).slice(0, 80), () => expect(safeSql(sql)).toBe(false));
  }
  for (const sql of benignStatements) {
    it(`still stores ${JSON.stringify(sql).slice(0, 60)}`, () => expect(safeSql(sql)).toBe(true));
  }
});

describe('review: the active password and token are rejected anywhere', () => {
  it('rejects the active secret as a substring', () => {
    expect(safeSql('SELECT 1 -- note hunter2', ['hunter2'])).toBe(false);
  });
});
