// SPDX-License-Identifier: AGPL-3.0-only
import type { WritePhase } from '$lib/rows';
import { t } from '$lib/i18n';
import {
  batchClient,
  errorText,
  isRejection,
  type Action,
  type BatchClient,
  type Request,
  type Result,
} from './client';

export class BatchOperation {
  busy = $state(false);
  result = $state<Result | null>(null);
  error = $state('');
  unknown = $state(false);
  private generation = 0;
  private cancelCurrent: (() => void) | null = null;

  constructor(private client: Pick<BatchClient, 'execute'> = batchClient) {}

  cancel() {
    this.cancelCurrent?.();
  }
  reset() {
    this.cancel();
    this.generation++;
    this.busy = false;
    this.result = null;
    this.error = '';
    this.unknown = false;
  }

  async run(action: Action, request: Request, token: string, report: (phase: WritePhase) => void) {
    if (this.busy) return;
    const mine = ++this.generation;
    const controller = new AbortController();
    let sent = false;
    let settled = false;
    const finish = (phase: WritePhase) => {
      if (sent && !settled) {
        settled = true;
        report(phase);
      }
    };
    this.busy = true;
    this.result = null;
    this.error = '';
    this.unknown = false;
    let rejectAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    });
    this.cancelCurrent = () => {
      controller.abort();
      rejectAbort();
      finish('unknown');
    };
    const timer = setTimeout(() => this.cancelCurrent?.(), (request.timeout_ms || 10000) + 5000);
    try {
      const result = await Promise.race([
        this.client.execute(action, request, token, controller.signal, () => {
          sent = true;
          report('sending');
        }),
        aborted,
      ]);
      if (mine !== this.generation || controller.signal.aborted) return;
      const unknown =
        'statements' in result
          ? result.statements.some(
              (s) => s.outcome === 'outcome_unknown' || s.results.some((r) => r.truncated),
            )
          : result.outcome === 'outcome_unknown';
      this.result = result;
      this.unknown = unknown;
      finish(unknown ? 'unknown' : 'settled');
    } catch (cause) {
      const unknown = sent && !isRejection(cause);
      finish(unknown ? 'unknown' : 'settled');
      if (mine === this.generation) {
        this.unknown = unknown;
        this.error = unknown ? t('sqlBatch.unknown') : errorText(cause);
      }
    } finally {
      clearTimeout(timer);
      if (mine === this.generation) {
        this.busy = false;
        this.cancelCurrent = null;
      }
    }
  }
}
