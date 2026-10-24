// SPDX-License-Identifier: AGPL-3.0-only
// One asynchronous load with abort and stale-answer protection: a newer run or abort() makes
// every earlier answer irrelevant, so a late response of a previous connection is discarded.
export class Resource<T> {
  data = $state<T | null>(null);
  error = $state('');
  errorCode = $state('');
  busy = $state(false);
  private controller: AbortController | null = null;
  private generation = 0;

  async run(
    load: (signal: AbortSignal) => Promise<T>,
    fallback: string,
    options: { keep?: boolean } = {},
  ): Promise<T | null> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const current = ++this.generation;
    this.busy = true;
    this.error = '';
    this.errorCode = '';
    if (!options.keep) this.data = null;
    try {
      const result = await load(controller.signal);
      if (current !== this.generation || controller.signal.aborted) return null;
      this.data = result;
      return result;
    } catch (cause) {
      if (current === this.generation && !controller.signal.aborted) {
        this.error = cause instanceof Error && cause.message ? cause.message : fallback;
        this.errorCode = (cause as { code?: string } | null)?.code ?? '';
      }
      return null;
    } finally {
      if (current === this.generation) this.busy = false;
    }
  }

  /** Cancels a running load and discards its answer. */
  abort() {
    this.controller?.abort();
    this.controller = null;
    this.generation++;
    this.busy = false;
  }

  reset() {
    this.abort();
    this.data = null;
    this.error = '';
    this.errorCode = '';
  }
}
