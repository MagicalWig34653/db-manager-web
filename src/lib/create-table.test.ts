// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ApiClient } from './api';
import {
  CreateTableClient,
  newCreateDraft,
  newCreateColumn,
  prepareCreate,
  validateCreate,
} from './create-table';
const connection = { driver: 'sqlite' as const, database: 'synthetic' };
export const createCap = {
  contract_version: '0.6.0',
  features: ['table_create'],
  types: ['int64', 'text', 'binary', 'decimal'],
  max_columns: 32,
  max_primary_key_columns: 8,
  max_text_length: 1024,
  max_decimal_precision: 38,
  max_timeout_ms: 60000,
  max_request_bytes: 1048576,
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const valid = () => ({ ...newCreateDraft(), name: 'created' });
describe('confirmed structured new-table creation', () => {
  it('pins the independently frozen schema and backend bytes', () => {
    const pin = JSON.parse(readFileSync('src/lib/contract/v6/provenance.json', 'utf8'));
    expect(pin.source_commit).toBe('3d21e42b0806f2a1953bcbad47f1e9fcb2acda93');
    expect(
      createHash('sha256')
        .update(readFileSync('src/lib/contract/v6/api-v0.6.0.json'))
        .digest('hex'),
    ).toBe('b08b6aba858f72a3bad1fce2933e487eed017f5e35b4690cfd9fae3a590a6887');
  });
  it('preserves names and constant strings without SQL or numerical precision loss', () => {
    const draft = valid();
    draft.name = ' table";name ';
    draft.columns[0].value = '9223372036854775807';
    draft.columns[0].defaultMode = 'value';
    draft.columns.push({
      ...newCreateColumn(2),
      name: 'empty',
      length: '4',
      defaultMode: 'value',
      value: '',
    });
    draft.columns.push({ ...newCreateColumn(3), name: 'optional', defaultMode: 'null' });
    const input = prepareCreate(draft, connection);
    expect(input.table.name).toBe(' table";name ');
    expect(input.columns[0].default).toEqual({
      mode: 'value',
      value: { kind: 'integer', value: '9223372036854775807' },
    });
    expect(input.columns[1].default).toEqual({ mode: 'value', value: { kind: 'text', value: '' } });
    expect(input.columns[2].default).toEqual({ mode: 'null' });
    expect(input).not.toHaveProperty('sql');
    expect(input.confirm).toBe(true);
  });
  it('retains ordered composite keys and separates no default from NULL', () => {
    const draft = valid();
    draft.columns.push({ ...newCreateColumn(2), name: 'part', length: '10', nullable: false });
    draft.primary = [2, 1];
    expect(prepareCreate(draft, connection).primary_key).toEqual(['part', 'id']);
    expect(prepareCreate(draft, connection).columns[1].default).toEqual({ mode: 'none' });
  });
  it('rejects malformed names, UTF8 overflow, duplicate names, invalid keys and definition bounds', () => {
    const variants = [
      (d: ReturnType<typeof valid>) => {
        d.name = '';
      },
      (d: ReturnType<typeof valid>) => {
        d.name = 'ä'.repeat(32);
      },
      (d: ReturnType<typeof valid>) => {
        d.name = 'bad\0name';
      },
      (d: ReturnType<typeof valid>) => {
        d.name = '\ud800';
      },
      (d: ReturnType<typeof valid>) => {
        d.columns.push({ ...newCreateColumn(2), name: 'ID' });
      },
      (d: ReturnType<typeof valid>) => {
        d.columns[0].nullable = true;
      },
      (d: ReturnType<typeof valid>) => {
        d.primary = [99];
      },
      (d: ReturnType<typeof valid>) => {
        d.columns[0].kind = 'binary';
      },
      (d: ReturnType<typeof valid>) => {
        d.columns = [];
      },
      (d: ReturnType<typeof valid>) => {
        d.columns = Array.from({ length: 33 }, (_, i) => ({
          ...newCreateColumn(i),
          name: `field${i}`,
        }));
        d.primary = [];
      },
      (d: ReturnType<typeof valid>) => {
        d.columns = [
          ...Array.from({ length: 5 }, (_, i) => ({
            ...newCreateColumn(i),
            name: `field${i}`,
            length: '1024',
          })),
        ];
        d.primary = [];
      },
    ];
    for (const change of variants) {
      const draft = valid();
      change(draft);
      expect(() => prepareCreate(draft, connection)).toThrow();
    }
  });
  it('validates Int64/Decimal text, nullable defaults and portable PK budgets', () => {
    for (const value of ['+1', '01', '-0', '9223372036854775808', '1.5']) {
      const draft = valid();
      Object.assign(draft.columns[0], { defaultMode: 'value', value });
      expect(() => prepareCreate(draft, connection)).toThrow();
    }
    const draft = valid();
    draft.primary = [];
    Object.assign(draft.columns[0], {
      kind: 'decimal',
      precision: '38',
      scale: '20',
      defaultMode: 'value',
      value: '123456789012345678.12345678901234567890',
    });
    expect(prepareCreate(draft, connection).columns[0].default).toEqual({
      mode: 'value',
      value: { kind: 'decimal', value: draft.columns[0].value },
    });
    for (const value of ['1e3', '1.000000000000000000001', '9999999999999999999.0']) {
      draft.columns[0].value = value;
      expect(() => prepareCreate(draft, connection)).toThrow();
    }
    Object.assign(draft.columns[0], {
      kind: 'text',
      length: '513',
      nullable: false,
      defaultMode: 'none',
    });
    draft.primary = [1];
    expect(() => prepareCreate(draft, connection)).toThrow();
    Object.assign(draft.columns[0], { kind: 'binary', defaultMode: 'value', value: 'AA==' });
    draft.primary = [];
    expect(() => prepareCreate(draft, connection)).toThrow();
  });
  it('rejects oversized credentials before any dispatch', async () => {
    const fetcher = vi.fn();
    const input = prepareCreate(valid(), connection);
    input.connection = { ...connection, password: 'ü'.repeat(600000) };
    await expect(
      new CreateTableClient(new ApiClient(fetcher)).create(
        input,
        'token',
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps older instances read-only compatible without any create POST', async () => {
    const fetcher = vi.fn(async () => new Response('Not Found', { status: 404 }));
    const client = new CreateTableClient(new ApiClient(fetcher));
    await expect(
      client.create(
        prepareCreate(valid(), connection),
        'token',
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toMatchObject({ code: 'unsupported_feature' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not reinterpret confirmed creation with unavailable metadata as a failed operation', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(createCap))
      .mockResolvedValueOnce(
        response({
          outcome: 'created',
          structure_check: 'unavailable',
          snapshot_atomic: false,
          message: 'Anlage bestätigt, Strukturprüfung nicht verfügbar.',
        }),
      );
    const onDispatch = vi.fn();
    const result = await new CreateTableClient(new ApiClient(fetcher)).create(
      prepareCreate(valid(), connection),
      'token',
      new AbortController().signal,
      onDispatch,
    );
    expect(result.outcome).toBe('created');
    expect(result.structure_check).toBe('unavailable');
    expect(onDispatch).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).not.toHaveProperty('sql');
  });
  it('preserves each confirmed structure observation without inventing rollback or atomicity', () => {
    const description = {
      table: { name: 'created' },
      kind: 'table',
      columns: [
        {
          name: 'id',
          database_type: 'BIGINT',
          nullable: false,
          pk_position: 1,
          generated: 'none',
          read_only: true,
        },
      ],
      primary_key: ['id'],
      read_only: true,
      stable_order: true,
      storage_engine: 'InnoDB',
      transactional: 'yes',
    };
    for (const structure_check of ['transactional', 'observed', 'different'] as const) {
      const result = validateCreate('CreateTableResult', {
        outcome: 'created',
        structure_check,
        snapshot_atomic: structure_check === 'transactional',
        message: 'Anlage bestätigt',
        actual_description: description,
      });
      expect(result.outcome).toBe('created');
      expect(result.structure_check).toBe(structure_check);
    }
  });
  it('reports possible commit after lost/invalid successful responses without retry', async () => {
    for (const failure of ['network', 'invalid']) {
      const fetcher = vi.fn().mockResolvedValueOnce(response(createCap));
      if (failure === 'network')
        fetcher.mockRejectedValueOnce(new Error('synthetic transport loss'));
      else fetcher.mockResolvedValueOnce(response({ outcome: 'created' }));
      await expect(
        new CreateTableClient(new ApiClient(fetcher)).create(
          prepareCreate(valid(), connection),
          'token',
          new AbortController().signal,
          () => {},
        ),
      ).rejects.toMatchObject({ code: 'outcome_unknown' });
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
  it('validates response variants and never claims an atomic MySQL observation', () => {
    expect(() =>
      validateCreate('CreateTableResult', {
        outcome: 'created',
        structure_check: 'unavailable',
        snapshot_atomic: true,
        message: 'created',
      }),
    ).toThrow();
    expect(() =>
      validateCreate('CreateTableResult', {
        outcome: 'created',
        structure_check: 'observed',
        snapshot_atomic: false,
        message: 'created',
      }),
    ).toThrow();
  });
});
