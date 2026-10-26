// SPDX-License-Identifier: AGPL-3.0-only
import type { components } from '$lib/contract/v16/api-types';
export type Schemas = components['schemas'];
export type Kind = Schemas['ProgramTarget']['kind'];
export type Target = Schemas['ProgramTarget'];
export type Input = Schemas['ProgramInput'];
export type Change = Extract<Schemas['ProgramChangeRequest'], { connection: unknown }>;
export type Plan = Schemas['ProgramPlan'];
export type Result = Schemas['ProgramResult'];
export const kinds: Kind[] = ['view', 'function', 'procedure', 'trigger', 'event'];
export const types = [
  'integer',
  'bigint',
  'text',
  'boolean',
  'date',
  'timestamp',
  'numeric',
  'real',
  'double',
  'binary',
  'varchar',
] as const;
export const driverOf = (driver: string) =>
  driver === 'postgresql'
    ? 'postgres'
    : driver === 'mariadb'
      ? 'mysql'
      : (driver as 'sqlite' | 'mysql' | 'postgres');
export const bodyFits = (body: string) => new TextEncoder().encode(body).length <= 262144;
