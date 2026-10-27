// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Poller, backoffDelay, type PollOutcome } from './poller';

const ok: PollOutcome = { ok: true };
const fail = (code: string): PollOutcome => ({ ok: false, code });

function make(
  outcomes: (() => Promise<PollOutcome>)[],
  extra: { hidden?: { value: boolean } } = {},
) {
  const run = vi.fn(async () => (outcomes.shift() ?? (async () => ok))());
  const abort = vi.fn();
  const poller = new Poller({
    intervalMs: 1000,
    run,
    abort,
    isHidden: () => extra.hidden?.value ?? false,
    maxFailures: 3,
    maxBackoffMs: 8000,
  });
  return { poller, run, abort };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Poller', () => {
  it('does nothing until started and runs after the interval', async () => {
    const { poller, run } = make([]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).not.toHaveBeenCalled();
    poller.start();
    await vi.advanceTimersByTimeAsync(999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    poller.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('never overlaps requests: the next run is scheduled only after the previous finished', async () => {
    let release: () => void = () => {};
    const { poller, run } = make([
      () => new Promise<PollOutcome>((resolve) => (release = () => resolve(ok))),
    ]);
    poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(poller.state).toBe('running');
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('backs off exponentially after failures and recovers after a success', async () => {
    expect(backoffDelay(1000, 0, 8000)).toBe(1000);
    expect(backoffDelay(1000, 2, 8000)).toBe(4000);
    expect(backoffDelay(1000, 9, 8000)).toBe(8000);
    const { poller, run } = make([async () => fail('network_error'), async () => fail('timeout')]);
    poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(poller.failures).toBe(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(poller.failures).toBe(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(run).toHaveBeenCalledTimes(3);
    expect(poller.failures).toBe(0);
    poller.stop();
  });

  it('stops for good after too many failures', async () => {
    const { poller, run } = make([
      async () => fail('network_error'),
      async () => fail('network_error'),
      async () => fail('network_error'),
    ]);
    poller.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(3);
    expect(poller.state).toBe('stopped');
    expect(poller.reason).toBe('failures');
  });

  it.each(['unauthorized', 'permission_denied', 'database_error_never_fatal'])(
    'handles %s',
    async (code) => {
      const { poller, run } = make([async () => fail(code)]);
      poller.start();
      await vi.advanceTimersByTimeAsync(1000);
      if (code === 'database_error_never_fatal') {
        expect(poller.state).toBe('waiting');
        poller.stop();
      } else {
        expect(poller.state).toBe('stopped');
        expect(poller.reason).toBe('fatal');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(run).toHaveBeenCalledTimes(1);
      }
    },
  );

  it('pauses in the background, aborts the in-flight request and resumes with a fresh one', async () => {
    const hidden = { value: false };
    let release: () => void = () => {};
    const { poller, run, abort } = make(
      [() => new Promise<PollOutcome>((resolve) => (release = () => resolve(ok)))],
      { hidden },
    );
    poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(poller.state).toBe('running');
    hidden.value = true;
    poller.visibilityChanged();
    expect(abort).toHaveBeenCalledTimes(1);
    expect(poller.state).toBe('paused');
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    hidden.value = false;
    poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('does not start requests while hidden at start time', async () => {
    const hidden = { value: true };
    const { poller, run } = make([], { hidden });
    poller.start();
    expect(poller.state).toBe('paused');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).not.toHaveBeenCalled();
    poller.stop();
  });

  it('stop() aborts a running request and ignores its late answer', async () => {
    let release: () => void = () => {};
    const { poller, run, abort } = make([
      () => new Promise<PollOutcome>((resolve) => (release = () => resolve(fail('network_error')))),
    ]);
    poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    poller.stop();
    expect(abort).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(poller.state).toBe('off');
  });
});
