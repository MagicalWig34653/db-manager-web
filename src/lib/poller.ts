// SPDX-License-Identifier: AGPL-3.0-only
// Opt-in auto refresh for read-only views. Guarantees: never two requests at once (the next run is
// scheduled only after the previous one finished), pauses while the page is hidden (the in-flight
// request is aborted, a fresh one starts when the page is visible again), backs off exponentially
// after failures and stops for good on authorization/permission errors or too many failures.

export type PollOutcome = { ok: true } | { ok: false; code: string };
export type PollerState = 'off' | 'waiting' | 'running' | 'paused' | 'stopped';
export type StopReason = 'fatal' | 'failures' | null;

/** Error codes that retrying cannot fix; polling stops immediately. */
export const fatalCodes: ReadonlySet<string> = new Set([
  'unauthorized',
  'permission_denied',
  'invalid_connection',
  'invalid_request',
  'invalid_server_admin',
  'invalid_monitor',
  'unsupported_feature',
  'unsupported_action',
  'not_found',
  'invalid_response',
]);

export interface PollerOptions {
  intervalMs: number;
  /** Runs one refresh; must resolve (never reject) with the outcome. */
  run: () => Promise<PollOutcome>;
  /** Cancels the refresh that is currently in flight. */
  abort: () => void;
  isHidden?: () => boolean;
  maxFailures?: number;
  maxBackoffMs?: number;
  onChange?: (state: PollerState, failures: number, reason: StopReason) => void;
  timers?: {
    set: (callback: () => void, ms: number) => unknown;
    clear: (handle: unknown) => void;
  };
}

export const backoffDelay = (intervalMs: number, failures: number, maxMs: number) =>
  Math.min(intervalMs * 2 ** Math.max(0, failures), maxMs);

export class Poller {
  state: PollerState = 'off';
  failures = 0;
  reason: StopReason = null;
  private enabled = false;
  private handle: unknown = null;
  private generation = 0;
  private readonly maxFailures: number;
  private readonly maxBackoff: number;
  private readonly timers: NonNullable<PollerOptions['timers']>;

  constructor(private options: PollerOptions) {
    this.maxFailures = options.maxFailures ?? 5;
    this.maxBackoff = options.maxBackoffMs ?? 300_000;
    this.timers = options.timers ?? {
      set: (callback, ms) => setTimeout(callback, ms),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
  }

  private set(state: PollerState) {
    this.state = state;
    this.options.onChange?.(state, this.failures, this.reason);
  }

  private clearTimer() {
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = null;
  }

  private schedule(ms: number) {
    this.clearTimer();
    this.set('waiting');
    this.handle = this.timers.set(() => {
      this.handle = null;
      void this.tick();
    }, ms);
  }

  setInterval(ms: number) {
    this.options.intervalMs = ms;
    if (this.enabled && this.state === 'waiting') this.schedule(this.nextDelay());
  }

  private nextDelay() {
    return backoffDelay(this.options.intervalMs, this.failures, this.maxBackoff);
  }

  start() {
    this.stopInternal();
    this.enabled = true;
    this.failures = 0;
    this.reason = null;
    if (this.options.isHidden?.()) this.set('paused');
    else this.schedule(this.options.intervalMs);
  }

  /** Switches auto refresh off (user action, unmount, connection change). */
  stop() {
    this.stopInternal();
    this.reason = null;
    this.set('off');
  }

  private stopInternal() {
    this.enabled = false;
    this.generation++;
    this.clearTimer();
    if (this.state === 'running') this.options.abort();
  }

  /** Call when document visibility changes. */
  visibilityChanged() {
    if (!this.enabled) return;
    if (this.options.isHidden?.()) {
      this.generation++;
      this.clearTimer();
      if (this.state === 'running') this.options.abort();
      this.set('paused');
    } else if (this.state === 'paused') {
      void this.tick();
    }
  }

  private async tick() {
    if (!this.enabled || this.state === 'running') return;
    if (this.options.isHidden?.()) {
      this.set('paused');
      return;
    }
    const current = ++this.generation;
    this.set('running');
    let outcome: PollOutcome;
    try {
      outcome = await this.options.run();
    } catch {
      outcome = { ok: false, code: 'network_error' };
    }
    if (current !== this.generation || !this.enabled) return;
    if (outcome.ok) {
      this.failures = 0;
      this.schedule(this.options.intervalMs);
      return;
    }
    if (fatalCodes.has(outcome.code)) return this.halt('fatal');
    this.failures += 1;
    if (this.failures >= this.maxFailures) return this.halt('failures');
    this.schedule(this.nextDelay());
  }

  private halt(reason: Exclude<StopReason, null>) {
    this.enabled = false;
    this.clearTimer();
    this.reason = reason;
    this.set('stopped');
  }
}
