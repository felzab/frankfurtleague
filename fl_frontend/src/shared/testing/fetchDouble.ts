import assert from "node:assert/strict";
import { afterEach, beforeEach, mock } from "node:test";

/**
 * A request no case answered fails that case by its address when it ends: left silent, it passes a
 * case that never saw an answer, with its transition pending into the next.
 */
export function doubleFetch() {
  const unanswered: string[] = [];
  const fetchMock = mock.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input) => {
    unanswered.push(String(input));
    return new Promise<never>(() => undefined);
  });
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => fetchMock(input, init)) as typeof fetch;

  // Per case, so an answer one case set is never the one a later case's request meets.
  beforeEach(() => {
    fetchMock.mock.restore();
    fetchMock.mock.resetCalls();
    unanswered.length = 0;
  });

  afterEach(() => {
    assert.deepEqual(unanswered, [], "the case sent a request it never answered; answer it, or hold it with a promise of its own");
  });

  return fetchMock;
}
