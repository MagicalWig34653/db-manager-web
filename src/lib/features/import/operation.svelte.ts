// SPDX-License-Identifier: AGPL-3.0-only
import { ApiError } from '$lib/api';
import type { WritePhase } from '$lib/rows';
import { t } from '$lib/i18n';
import { errorText, importClient, isRejection, type ImportClient } from './client';
import {
  resultUnknown,
  type ExecuteRequest,
  type Job,
  type Plan,
  type PlanRequest,
  type Result,
} from './model';

export type Phase =
  'idle' | 'planning' | 'planned' | 'uploading' | 'starting' | 'running' | 'finished' | 'unknown';

export interface Deps {
  client?: Pick<ImportClient, 'plan' | 'execute' | 'status' | 'cancel'>;
  /** Poll interval; tests pass a short one. */
  pollMs?: number;
  /** Consecutive unreadable status answers tolerated before the outcome is declared unknown. */
  maxStatusFailures?: number;
}

/**
 * One import per operation: CSV goes plan -> execute -> poll, SQL goes execute -> poll. The execute request is sent at
 * most once per plan; after it was dispatched the plan is consumed and nothing is ever re-sent automatically.
 */
export class ImportOperation {
  phase = $state<Phase>('idle');
  plan = $state<Plan | null>(null);
  /** The execute request left this browser (or was attempted): the one-time plan is spent. */
  consumed = $state(false);
  progress = $state({ loaded: 0, total: 0 });
  job = $state<Job | null>(null);
  result = $state<Result | null>(null);
  error = $state('');
  /** Short code of the last failure, for tests and error mapping. */
  errorCode = $state('');
  notice = $state('');
  unknown = $state(false);
  cancelRequested = $state(false);

  private generation = 0;
  private controller: AbortController | null = null;
  private report: ((phase: WritePhase) => void) | null = null;
  private reported: 'none' | 'sending' | 'done' = 'none';
  private planRequest: PlanRequest | null = null;

  constructor(private deps: Deps = {}) {}

  private get client() {
    return this.deps.client ?? importClient;
  }
  get busy() {
    return ['planning', 'uploading', 'starting', 'running'].includes(this.phase);
  }

  /** Aborts everything and forgets the plan. A running server job is not stopped by this. */
  reset() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    if (this.reported === 'sending') this.finishReport('unknown');
    this.phase = 'idle';
    this.plan = null;
    this.planRequest = null;
    this.consumed = false;
    this.progress = { loaded: 0, total: 0 };
    this.job = null;
    this.result = null;
    this.error = '';
    this.errorCode = '';
    this.notice = '';
    this.unknown = false;
    this.cancelRequested = false;
  }

  private finishReport(phase: 'settled' | 'unknown') {
    if (this.reported !== 'sending') return;
    this.reported = 'done';
    this.report?.(phase);
  }

  async makePlan(request: PlanRequest, file: Blob, token: string) {
    if (this.busy) return;
    this.reset();
    const mine = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.phase = 'planning';
    try {
      const plan = await this.client.plan(structuredClone(request), file, token, {
        signal: controller.signal,
        onDispatch: () => {},
        onProgress: (loaded, total) => {
          if (mine === this.generation) this.progress = { loaded, total };
        },
        onUploaded: () => {},
      });
      if (mine !== this.generation) return;
      this.plan = plan;
      this.planRequest = structuredClone(request);
      this.phase = 'planned';
    } catch (cause) {
      if (mine !== this.generation) return;
      this.phase = 'idle';
      if (controller.signal.aborted) this.notice = t('importData.planCancelled');
      else this.fail(cause);
    }
  }

  /** The metadata the planned execute request has to repeat exactly. */
  get plannedRequest(): PlanRequest | null {
    return this.planRequest ? structuredClone(this.planRequest) : null;
  }

  async execute(
    request: ExecuteRequest,
    file: Blob,
    token: string,
    report: (phase: WritePhase) => void,
  ) {
    // Synchronous guard: a double click or a second keyboard activation can never produce a second request.
    if (this.busy || this.consumed || (request.format === 'csv' && this.phase !== 'planned'))
      return;
    if (request.format === 'sql' && this.phase !== 'idle') return;
    const mine = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.report = report;
    this.reported = 'none';
    this.error = '';
    this.errorCode = '';
    this.notice = '';
    this.unknown = false;
    this.cancelRequested = false;
    this.result = null;
    this.job = null;
    this.progress = { loaded: 0, total: 0 };
    this.phase = 'uploading';
    let dispatched = false;
    // Every body byte was handed to the network: the server may already have read the file and started.
    let bodySent = false;
    let job: Job;
    try {
      job = await this.client.execute(structuredClone(request), file, token, {
        signal: controller.signal,
        onDispatch: () => {
          dispatched = true;
          this.consumed = true;
          this.reported = 'sending';
          report('sending');
        },
        onProgress: (loaded, total) => {
          if (total > 0 && loaded >= total) bodySent = true;
          if (mine === this.generation) this.progress = { loaded, total };
        },
        onUploaded: () => {
          if (mine === this.generation && this.phase === 'uploading') this.phase = 'starting';
        },
      });
    } catch (cause) {
      if (mine !== this.generation) return;
      this.controller = null;
      const aborted = controller.signal.aborted;
      if (aborted && this.phase === 'uploading' && !bodySent) {
        // The request body was not completely sent, so the server cannot have started the import.
        this.consumed = false;
        this.finishReport('settled');
        this.notice = t('importData.uploadCancelled');
        this.phase = request.format === 'csv' ? 'planned' : 'idle';
        return;
      }
      if (!aborted && (!dispatched || isRejection(cause))) {
        // Refused before any work started. The one-time plan counts as spent once the request left the browser.
        this.finishReport('settled');
        this.fail(cause);
        if (request.format === 'sql') this.consumed = false;
        this.phase = request.format === 'csv' ? 'planned' : 'idle';
        return;
      }
      this.declareUnknown();
      return;
    }
    if (mine !== this.generation) return;
    this.job = job;
    this.phase = job.state === 'finished' ? 'finished' : 'running';
    if (job.state === 'finished') this.settle(job);
    else void this.poll(mine, job.id, token);
  }

  private fail(cause: unknown) {
    this.errorCode = cause instanceof ApiError ? cause.code : 'unknown';
    this.error = errorText(cause);
  }

  private declareUnknown() {
    this.phase = 'unknown';
    this.unknown = true;
    this.error = t('importData.unknownNoRetry');
    this.finishReport('unknown');
  }

  private settle(job: Job) {
    const result = job.result!;
    this.result = result;
    this.job = job;
    this.phase = 'finished';
    this.unknown = resultUnknown(result);
    this.finishReport(this.unknown ? 'unknown' : 'settled');
  }

  private async poll(mine: number, id: string, token: string) {
    const interval = this.deps.pollMs ?? 1000;
    const limit = this.deps.maxStatusFailures ?? 5;
    let failures = 0;
    const controller = this.controller ?? new AbortController();
    while (mine === this.generation) {
      await new Promise((resolve) => setTimeout(resolve, interval));
      if (mine !== this.generation) return;
      try {
        const job = await this.client.status(id, token, controller.signal);
        if (mine !== this.generation) return;
        failures = 0;
        this.job = job;
        if (job.state === 'finished') {
          this.settle(job);
          return;
        }
      } catch (cause) {
        if (mine !== this.generation) return;
        if (controller.signal.aborted) return;
        failures++;
        const gone =
          cause instanceof ApiError &&
          ['not_found', 'unauthorized', 'invalid_response'].includes(cause.code);
        if (gone || failures >= limit) {
          this.errorCode = cause instanceof ApiError ? cause.code : 'unknown';
          this.declareUnknown();
          return;
        }
      }
    }
  }

  /** Requests a stop of the running job; the final state still comes from the status poll. */
  async cancel(token: string) {
    if (this.phase === 'planning' || this.phase === 'uploading') {
      this.controller?.abort();
      return;
    }
    if (this.phase === 'starting') {
      // The body is fully sent; the server may already have started. Stop waiting and say so honestly.
      this.controller?.abort();
      return;
    }
    if (this.phase !== 'running' || !this.job || this.cancelRequested) return;
    this.cancelRequested = true;
    try {
      const job = await this.client.cancel(this.job.id, token, new AbortController().signal);
      if (job.state === 'finished') this.settle(job);
      else this.job = job;
    } catch {
      // The poll keeps watching; a lost cancel call changes nothing about the server state. The request can be
      // repeated because it never arrived (or its answer was lost); the server treats a second stop as a no-op.
      this.cancelRequested = false;
    }
  }
}
