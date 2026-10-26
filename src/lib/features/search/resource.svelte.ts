// SPDX-License-Identifier: AGPL-3.0-only
import { searchError } from './client';
export class Resource<T> {
  data = $state<T | null>(null);
  busy = $state(false);
  error = $state('');
  private generation = 0;
  private controller: AbortController | null = null;
  reset() {
    this.abort();
    this.data = null;
    this.error = '';
  }
  abort() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.busy = false;
  }
  async run(load: (signal: AbortSignal) => Promise<T>) {
    this.reset();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.busy = true;
    try {
      const data = await load(controller.signal);
      if (generation === this.generation) this.data = data;
    } catch (cause) {
      if (generation === this.generation) this.error = searchError(cause);
    } finally {
      if (generation === this.generation) this.busy = false;
    }
  }
}
