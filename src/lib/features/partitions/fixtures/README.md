# Fixtures

Unchanged answers of the Go backend (main d9463ba, API 0.22): `*.real-postgres|mysql.json` are the
live-test dumps from `contracts/fixtures/partitions/` of that revision (MySQL 8.4, PostgreSQL 18.6);
`*.real-sqlite.json`, `PartitionsCapabilities.real.json` and `StructurePlan.real-prefix-sqlite.json` were
recorded from a locally built backend at that revision with synthetic tables. Every file is validated
against the vendored v22 contract in `partitions.test.ts`. No credentials or host data.
