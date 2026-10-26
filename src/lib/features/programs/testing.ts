// SPDX-License-Identifier: AGPL-3.0-only
import caps from './fixtures/ProgramsCapabilities.sqlite-observed.json' with { type: 'json' };
import observedPlan from './fixtures/ProgramPlan.sqlite-observed.json' with { type: 'json' };
import observedList from './fixtures/ProgramsResult.sqlite-observed.json' with { type: 'json' };
import observedResult from './fixtures/ProgramResult.sqlite-observed.json' with { type: 'json' };
import type { Plan, Result, Schemas } from './model';
export const capabilities = () => structuredClone(caps) as Schemas['ProgramsCapabilities'];
export const listing = () => structuredClone(observedList) as Schemas['ProgramsResult'];
export const program = () => ({ ...listing().objects[0], body: 'SELECT 42 AS value' });
export const plan = (over: Partial<Plan> = {}): Plan => ({
  ...(structuredClone(observedPlan) as Plan),
  ...over,
});
export const result = (over: Partial<Result> = {}): Result => ({
  ...(structuredClone(observedResult) as Result),
  ...over,
});
