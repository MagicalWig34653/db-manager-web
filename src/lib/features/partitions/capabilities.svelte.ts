// SPDX-License-Identifier: AGPL-3.0-only
import { errorCode, partitionsClient, structureErrorMessage } from './client';
import type { PartitionsCapabilities } from './model';

/** Loads GET /api/v22/capabilities once per connection/token; late answers are discarded. */
export class CapabilityState {
  state = $state<'loading' | 'ready' | 'unsupported' | 'failed'>('loading');
  data = $state<PartitionsCapabilities | null>(null);
  message = $state('');
  private generation = 0;
  private controller: AbortController | null = null;

  async load(token: string) {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const current = ++this.generation;
    this.state = 'loading';
    this.data = null;
    this.message = '';
    try {
      const data = await partitionsClient.capabilities(token, controller.signal);
      if (current !== this.generation) return;
      this.data = data;
      this.state = 'ready';
    } catch (cause) {
      if (current !== this.generation || controller.signal.aborted) return;
      this.message = structureErrorMessage(cause);
      this.state = errorCode(cause) === 'unsupported_feature' ? 'unsupported' : 'failed';
    }
  }
  abort() {
    this.generation++;
    this.controller?.abort();
  }
}
