import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attemptFixture, upgradeFixture } from '@/mocks/upgrade';
import {
  getUpgradeStatus,
  lookupUpgradeRequest,
  requestInstanceUpgrade,
} from '@/services/api/upgrade.service';

function delayedResponse(body: unknown, delayMs: number) {
  const signals: AbortSignal[] = [];
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
    const signal = init?.signal;
    if (signal === null || signal === undefined) throw new Error('Abort signal required');
    signals.push(signal);
    return new Promise<Response>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException('Request aborted', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve(Response.json(body));
      }, delayMs);
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
    });
  });
  return { fetch, signals };
}

function upgradeRequest() {
  const accepted = attemptFixture();
  return {
    accepted,
    input: {
      requestId: accepted.requestId,
      targetReleaseId: accepted.targetReleaseId,
      targetDigest: accepted.targetDigest,
      expectedActivationGeneration: upgradeFixture().activationGeneration,
    },
  };
}

describe('UPG control request budget and cancellation', () => {
  it('requests the async contract only for an explicitly capable target and keeps legacy fallback', async () => {
    const { accepted, input } = upgradeRequest();
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(Response.json(accepted)));
    await expect(requestInstanceUpgrade(input, 'csrf-fixture', true)).resolves.toEqual(accepted);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('Prefer')).toBe('respond-async');
    await lookupUpgradeRequest(input.requestId, undefined, true);
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('Prefer')).toBe('respond-async');
    await requestInstanceUpgrade(input, 'csrf-fixture');
    expect(new Headers(fetch.mock.calls[2]?.[1]?.headers).has('Prefer')).toBe(false);
  });
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('bounds status reads to two seconds without waiting for business source verification', async () => {
    const status = upgradeFixture();
    const { fetch, signals } = delayedResponse(status, 59_645);
    const pending = getUpgradeStatus();
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1999);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(signals[0]?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds async acceptance and reconciles the same request with a read instead of resubmission', async () => {
    const { accepted, input } = upgradeRequest();
    const { fetch, signals } = delayedResponse(accepted, 59_645);
    const pending = requestInstanceUpgrade(input, 'csrf-fixture', true);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(2000);
    await rejected;
    expect(signals[0]?.aborted).toBe(true);
    fetch.mockResolvedValueOnce(Response.json(accepted));
    await expect(lookupUpgradeRequest(input.requestId, undefined, true)).resolves.toEqual(accepted);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1]?.method).toBeUndefined();
    expect(fetch.mock.calls[1]?.[0]).toBe(
      `http://localhost:3001/api/system/upgrade/requests/${input.requestId}`,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('also bounds original-request lookups without creating another command', async () => {
    const { accepted, input } = upgradeRequest();
    const { fetch, signals } = delayedResponse(accepted, 59_645);
    const pending = lookupUpgradeRequest(input.requestId);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(2000);
    await rejected;
    expect(signals[0]?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.method).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows two source verifications while retaining the single command identity', async () => {
    const { accepted, input } = upgradeRequest();
    const { fetch, signals } = delayedResponse(accepted, 119_290);
    const pending = requestInstanceUpgrade(input, 'csrf-fixture');
    await vi.advanceTimersByTimeAsync(119_290);
    await expect(pending).resolves.toEqual(accepted);
    expect(signals[0]?.aborted).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = fetch.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Expected a JSON request body');
    expect(JSON.parse(body)).toEqual(input);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts at the fixed control deadline and looks up the same request without redispatch', async () => {
    const { accepted, input } = upgradeRequest();
    const { fetch, signals } = delayedResponse(accepted, 300_000);
    const pending = requestInstanceUpgrade(input, 'csrf-fixture');
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(239_999);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(signals[0]?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    fetch.mockResolvedValueOnce(Response.json(accepted));
    await expect(lookupUpgradeRequest(input.requestId)).resolves.toEqual(accepted);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[0]).toBe(
      `http://localhost:3001/api/system/upgrade/requests/${input.requestId}`,
    );
    expect(fetch.mock.calls[1]?.[1]?.method).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors explicit caller cancellation immediately', async () => {
    const { signals } = delayedResponse(upgradeFixture(), 300_000);
    const caller = new AbortController();
    const pending = getUpgradeStatus(caller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    caller.abort();
    await rejected;
    expect(signals[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not keep an already cancelled caller request alive', async () => {
    const { fetch, signals } = delayedResponse(upgradeFixture(), 300_000);
    const caller = new AbortController();
    caller.abort();
    await expect(getUpgradeStatus(caller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
