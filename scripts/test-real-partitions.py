#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""W-P29: run the production web UI (partitions and table prefix batch) against a real Go backend with throwaway
SQLite and PostgreSQL 18.6 (TLS verify-full; declarative partitions are real there). Backend:
DBM_BACKEND_REPO / DBM_BACKEND_REV (e.g. d9463ba). MySQL and MariaDB partitions are covered by the backend suite."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('real_wave4', Path(__file__).resolve().parent / 'real_wave4.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


def prepare(backend, token, pg, ctx):
    def query(connection, sql):
        return h.api(backend, '/api/v1/query', token, {'connection': connection, 'sql': sql})
    lite = {'driver': 'sqlite', 'database': 'w4_part'}
    for connection in (lite, pg):
        query(connection, 'CREATE TABLE keep_me (id INTEGER PRIMARY KEY, v TEXT)')
        query(connection, "INSERT INTO keep_me VALUES (1, 'unchanged')")
    print('W-P29 real: synthetic fixtures created (SQLite, PostgreSQL).', flush=True)


def main():
    h.harness('w-p29', 'tests/real/partitions.spec.ts', [22], prepare)


if __name__ == '__main__':
    h.guarded(main)
