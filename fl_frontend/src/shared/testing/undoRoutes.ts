import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { AENDERUNG_STEHT_WEITERHIN, KONFLIKT_MIT_BESTEHENDEM } from "@/shared/utils/actionError.ts";

import { doubleActionRequest, doubleActions } from "./actionDoubles.ts";
import { DUPLICATE_KEY } from "./publishedRefusals.ts";

import type { NextRequest } from "next/server";

/** An undo route's answer, as the dispatch reads its body. */
export type UndoAnswer = { success: boolean; message?: string; error?: string; warn?: boolean; outcome?: "unknown" };

/**
 * The request an undo route runs in and the slice's `mutations.ts` its replay writes through, every
 * write acknowledged until a case names another answer. Registered before the suite's `await import`
 * of the route, as `fl_frontend/src/shared/testing/actionDoubles.ts :: doubleActionRequest` is.
 */
export function doubleUndoRequest(mutations: string): ReturnType<typeof doubleActions> {
  doubleActionRequest();
  registerHooks({
    // `next` publishes no `exports` map, so Node finds the subpath only with the extension a bundler would supply.
    resolve: (specifier, context, nextResolve) => nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context),
  });

  return doubleActions({ modules: [mutations], answer: () => Promise.resolve({ acknowledged: 1 }) });
}

/** One press through the route's own `POST`, same-origin unless a case says otherwise. */
export async function undo(
  post: (request: NextRequest) => Promise<Response>,
  body: unknown,
  secFetchSite = "same-origin",
): Promise<UndoAnswer> {
  const answered = await post({ headers: new Headers({ "sec-fetch-site": secFetchSite }), json: async () => body } as never);

  return (await answered.json()) as UndoAnswer;
}

/**
 * Every code's answer a reason closed once on `closing`: a code the route's table leaves unmapped
 * falls through to the shared 409 sentence, which says nothing of what became of the change.
 */
export async function assertEachRefusalCloses({
  codes,
  refuse,
  press,
  closing = AENDERUNG_STEHT_WEITERHIN,
}: {
  /** `publishedRefusals(operation)`, spelled at the call so the coverage sweep reads the operation there. */
  codes: readonly string[];
  refuse: (code: string) => void;
  press: () => Promise<UndoAnswer>;
  /** What became of the change; a replay of two writes that restored the first names that half instead. */
  closing?: string;
}): Promise<Map<string, string>> {
  const answers = new Map<string, string>();

  for (const code of codes) {
    refuse(code);
    const answer = await press();
    const error = answer.error ?? "";

    assert.equal(answer.success, false, `${code} resolved as a restore`);
    assert.ok(error.endsWith(` ${closing}`), `${code} closes on something else: ${error}`);
    assert.match(error.slice(0, -closing.length - 1), /\S\.$/, `${code} names no reason before what became of the change`);
    assert.equal(error.split(closing).length, 2, `${code} states what became of the change twice`);
    if (closing !== AENDERUNG_STEHT_WEITERHIN)
      assert.ok(!error.includes(AENDERUNG_STEHT_WEITERHIN), `${code} says the change stands after a half went back`);
    // Whichever write met it, the unique index's refusal is the conflict the shared 409 reader words.
    if (code === DUPLICATE_KEY) assert.equal(error, `${KONFLIKT_MIT_BESTEHENDEM} ${closing}`);

    answers.set(code, error);
  }

  return answers;
}
