import assert from "node:assert/strict";
import { after, afterEach, beforeEach, mock } from "node:test";

import { judgeAtProcessEnd, judging } from "@/core/verdicts.ts";
import { untilAnswered } from "@/shared/testing/answersInFlight.ts";

import type { InFlight } from "@/shared/testing/answersInFlight.ts";
import type { Mock } from "node:test";

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * A request no case answered fails that case by its address when it ends: left silent, it passes a
 * case that never saw an answer, with its transition pending into the next.
 */
export function doubleFetch(): {
  readonly mock: Mock<Fetch>["mock"];
  /**
   * Awaited inside `act` before a poll of the page, so the render an answer sets off lands inside it: a
   * poll alone gives up after its second, which a loaded machine's answer and render outlast.
   */
  answered: () => Promise<void>;
} {
  const unanswered: string[] = [];
  const unansweredDouble = (): Mock<Fetch> =>
    mock.fn<Fetch>((input) => {
      unanswered.push(String(input));
      return new Promise<never>(() => undefined);
    });

  // A fresh double per case rather than `restore()`, which leaves an unused once-answer standing for
  // the next case's request to meet.
  let current = unansweredDouble();
  const inFlight = new Set<InFlight>();
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const answer = current(input, init);
    const entry = { name: String(input), answer };
    inFlight.add(entry);
    const settle = (): void => void inFlight.delete(entry);
    answer.then(settle, settle);
    return answer;
  }) as typeof fetch;

  /** Emptied as it is judged, so one request fails one place. */
  const judge = (where: string): void => {
    const sent = unanswered.splice(0);
    assert.deepEqual(sent, [], `${where}; answer it, or hold it with a promise of its own`);
  };

  beforeEach(() => {
    judge("a request was sent between two cases, after the one before had ended");
    current = unansweredDouble();
    inFlight.clear();
  });
  afterEach((t) => judging(t.fullName, () => judge("the case sent a request it never answered")));
  after(() => judging("the file's last case", () => judge("a request was sent after the file's last case had ended")));
  // A timer queued as the last case ends fires after every hook, so the process's end judges once more.
  judgeAtProcessEnd(() => judge("a request was sent after the file's hooks had run"));

  return {
    get mock() {
      return current.mock;
    },
    answered: () => untilAnswered(() => [...inFlight], "settle a held answer before awaiting `answered`"),
  };
}
