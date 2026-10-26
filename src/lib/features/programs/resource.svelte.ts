// SPDX-License-Identifier: AGPL-3.0-only
import { errorMessage } from './client';
export class Resource<T> {
  data = $state<T | null>(null);
  error = $state('');
  busy = $state(false);
  private generation = 0;
  private controller: AbortController | null = null;
  reset() {
    this.generation++;
    this.controller?.abort();
    this.data = null;
    this.error = '';
    this.busy = false;
  }
  async run(load: (signal: AbortSignal) => Promise<T>) {
    this.reset();
    const current = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.busy = true;
    try {
      const data = await load(controller.signal);
      if (current === this.generation) this.data = data;
    } catch (cause) {
      if (current === this.generation) this.error = errorMessage(cause);
    } finally {
      if (current === this.generation) this.busy = false;
    }
  }
}
