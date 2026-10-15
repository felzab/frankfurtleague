import assert from "node:assert/strict";

import { APIBadStatusError } from "@/core/errors.ts";
import { AENDERUNG_STEHT_WEITERHIN, KONFLIKT_MIT_BESTEHENDEM } from "@/shared/utils/actionError.ts";

import { cacheCalls } from "./actionDoubles.ts";
import { DUPLICATE_KEY } from "./publishedRefusals.ts";

import type { UndoOutcome } from "@/shared/utils/adminUndo.ts";

/** Every tag the undo's spine dropped, in the order it dropped them. */
export const droppedTags = (): unknown[] => cacheCalls.filter(({ name }) => name === "updateTag").map(({ args }) => args[0]);

/** How often the spine or the action asked Next to read the page again since the case began. */
export const refreshes = (): number => cacheCalls.filter(({ name }) => name === "refresh").length;

/** A write's definite failure as `apiClient` raises it: the server answered 500 having written nothing (`DB-FAIL-001`). */
export const failedWrite = (endpoint: string): APIBadStatusError =>
  new APIBadStatusError({
    message: "failed",
    url: `http://backend:8000/api/v0${endpoint}`,
    endpoint,
    method: "PATCH",
    readOnly: false,
    traceId: "ab".repeat(16),
    statusCode: 500,
    serverErrorCode: "DB-FAIL-001",
  });

/** An undo's answer where its replay's write went unacknowledged, which may still have landed. */
export const unacknowledged = (error: string): UndoOutcome => ({ success: false, error, outcome: "unknown" });

/**
 * Every code's answer a reason closed once on `closing`: a code the action's table leaves unmapped
 * falls through to the shared sentence, which says nothing of what became of the change.
 */
export async function assertEachRefusalCloses({
  codes,
  refuse,
  press,
  closing = AENDERUNG_STEHT_WEITERHIN,
}: {
  /** `publishedRefusals(operation)`, filtered where the action answers a code apart. */
  codes: readonly string[];
  refuse: (code: string) => void;
  press: () => Promise<UndoOutcome>;
  /** What became of the change; a replay of two writes that restored the first names that half instead. */
  closing?: string;
}): Promise<Map<string, string>> {
  const answers = new Map<string, string>();

  for (const code of codes) {
    refuse(code);
    const answer = await press();
    const error = answer.success ? "" : answer.error;

    assert.equal(answer.success, false, `${code} resolved as a restore`);
    assert.ok(error.endsWith(` ${closing}`), `${code} closes on something else: ${error}`);
    assert.match(error.slice(0, -closing.length - 1), /\S\.$/, `${code} names no reason before what became of the change`);
    assert.equal(error.split(closing).length, 2, `${code} states what became of the change twice`);
    if (closing !== AENDERUNG_STEHT_WEITERHIN)
      assert.ok(!error.includes(AENDERUNG_STEHT_WEITERHIN), `${code} says the change stands after a half went back`);
    // Whichever write met it, the unique index's refusal is the conflict the shared reader words.
    if (code === DUPLICATE_KEY) assert.equal(error, `${KONFLIKT_MIT_BESTEHENDEM} ${closing}`);

    answers.set(code, error);
  }

  return answers;
}
