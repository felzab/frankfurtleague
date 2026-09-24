import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import { doubleActionRequest, doubleActions } from "@/shared/testing/actionDoubles.ts";
import { DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";

/* The real route, called: the request it runs in and the write it replays are the doubles. */
doubleActionRequest();
registerHooks({
  // `next` publishes no `exports` map, so Node finds the subpath only with the extension a bundler would supply.
  resolve: (specifier, context, nextResolve) => nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context),
});
const { answerWith, calls } = doubleActions({
  modules: ["/src/features/spielorte/mutations.ts"],
  answer: () => Promise.resolve({ acknowledged: 1 }),
});
const { POST } = await import("./route.ts");
const { toActionErrorResult } = await import("@/shared/utils/actionError.ts");

/** What `fl_frontend/src/features/spielorte/mutations.ts :: patchSpielort` sends, as the backend's own routes spell it. */
const REPLAY_OPERATION = "PATCH /spielorte/{spielort_id}";

/** The pre-save venue the press replays, as the editor builds it. */
const BODY = {
  id: "6890a1b2c3d4e5f607a30001",
  name: "Sportpark Nord",
  default_mietpreis: 40,
  address: { strasse: "Am Sportpark", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" },
};

type Outcome = { success: boolean; message?: string; error?: string };

async function undo(body: unknown): Promise<Outcome> {
  const answered = await POST({ headers: new Headers({ "sec-fetch-site": "same-origin" }), json: async () => body } as never);
  return (await answered.json()) as Outcome;
}

describe("the venue save's undo", () => {
  it("replays the stored venue", async () => {
    calls.length = 0;
    const answer = await undo(BODY);

    assert.equal(answer.success, true, String(answer.error));
    assert.deepEqual(calls, [{ action: "patchSpielort", payload: BODY }]);
  });

  /* Three sites per refusal: a code the route's table leaves unmapped falls through to the shared 409
     sentence about an equivalent entry, which says nothing of what became of the change. */
  it("words every refusal the replayed endpoint publishes, closing on the change standing once", async () => {
    for (const code of publishedRefusals(REPLAY_OPERATION)) {
      answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, code)));

      const answer = await undo(BODY);

      assert.equal(answer.success, false, `${code} resolved as a restore`);
      assert.match(answer.error ?? "", /\S\. Die Änderung steht weiterhin\.$/, `${code} leaves the admin guessing what the venue now holds`);
      assert.equal(answer.error?.split("Die Änderung steht weiterhin.").length, 2, `${code} states the outcome twice`);
    }
  });

  /* The unique index's refusal keeps the shared reader's own sentence, followed by the outcome as on
     every undo route: two spellings of one sentence, held together. */
  it("words the duplicate key as the shared reader does, saying the change stands", async () => {
    answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, DUPLICATE_KEY)));

    const answer = await undo(BODY);

    assert.equal(
      answer.error,
      `${String(toActionErrorResult(refusedOn(REPLAY_OPERATION, DUPLICATE_KEY)).error)} Die Änderung steht weiterhin.`,
    );
  });
});
