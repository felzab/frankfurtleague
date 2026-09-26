import assert from "node:assert/strict";
import { after, afterEach, beforeEach, mock } from "node:test";

import type { Mock } from "node:test";

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * A request no case answered fails that case by its address when it ends: left silent, it passes a
 * case that never saw an answer, with its transition pending into the next.
 */
export function doubleFetch(): { readonly mock: Mock<Fetch>["mock"] } {
  const unanswered: string[] = [];
  const unansweredDouble = (): Mock<Fetch> =>
    mock.fn<Fetch>((input) => {
      unanswered.push(String(input));
      return new Promise<never>(() => undefined);
    });

  // A fresh double per case rather than `restore()`, which leaves an unused once-answer standing for
  // the next case's request to meet.
  let current = unansweredDouble();
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => current(input, init)) as typeof fetch;

  /** Emptied as it is judged, so one request fails one place. */
  const judge = (where: string): void => {
    const sent = unanswered.splice(0);
    assert.deepEqual(sent, [], `${where}; answer it, or hold it with a promise of its own`);
  };

  beforeEach(() => {
    judge("a request was sent between two cases, after the one before had ended");
    current = unansweredDouble();
  });
  afterEach(() => judge("the case sent a request it never answered"));
  after(() => judge("a request was sent after the file's last case had ended"));
  // A timer queued as the last case ends fires after every hook, so the process's end judges once
  // more: the throw ends it non-zero, and the runner fails the file.
  process.once("beforeExit", () => judge("a request was sent after the file's hooks had run"));

  return {
    get mock() {
      return current.mock;
    },
  };
}
