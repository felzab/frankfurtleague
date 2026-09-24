import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import { doubleActionRequest, doubleActions } from "@/shared/testing/actionDoubles.ts";
import { DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";

/* The real route, called: the request it runs in and the write it replays are the doubles. */
doubleActionRequest();
const invalidated: string[] = [];
Reflect.set(globalThis, "__flKontakteUndoInvalidated", invalidated);
registerHooks({
  resolve: (specifier, context, nextResolve) => {
    // Recording rather than inert, and registered after the request's double so it answers first: the
    // contacts undo is the one replay that may clear no cached read.
    if (specifier === "next/cache") {
      const record = (name: string) =>
        `export const ${name} = (tag) => { globalThis.__flKontakteUndoInvalidated.push("${name} " + String(tag)); };`;
      const source = ["updateTag", "refresh", "revalidateTag", "revalidatePath"].map(record).join("\n");
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    // `next` publishes no `exports` map, so Node finds the subpath only with the extension a bundler would supply.
    return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context);
  },
});
const { answerWith, calls } = doubleActions({
  modules: ["/src/features/kontakte/mutations.ts"],
  answer: () => Promise.resolve({ acknowledged: 1 }),
});
const { POST } = await import("./route.ts");
const { toActionErrorResult } = await import("@/shared/utils/actionError.ts");

/** What `fl_frontend/src/features/kontakte/mutations.ts :: patchSaisonTeamKontakte` sends, as the backend's own routes spell it. */
const REPLAY_OPERATION = "PATCH /teams/{team_id}/saisons/{saison_id}/kontakte";

/** The stored block the press replays, and the token the save left, as the editor builds them. */
const BODY = { team_id: "6890a1b2c3d4e5f607182932", saison_id: "2026", kontakte: null, kontakte_stand: "9f2c" };

type Outcome = { success: boolean; message?: string; error?: string };

async function undo(body: unknown, secFetchSite = "same-origin"): Promise<Outcome> {
  const answered = await POST({ headers: new Headers({ "sec-fetch-site": secFetchSite }), json: async () => body } as never);
  return (await answered.json()) as Outcome;
}

/** The fallback a code the route's table leaves unmapped reaches, which speaks of an equivalent entry. */
const UNMAPPED = toActionErrorResult(refusedOn(REPLAY_OPERATION, "REQ-UNCLAIMED-000")).error;

describe("the contacts save's undo", () => {
  it("replays the save's own payload through the save's own write", async () => {
    calls.length = 0;
    const answer = await undo(BODY);

    assert.equal(answer.success, true, String(answer.error));
    assert.deepEqual(calls, [{ action: "patchSaisonTeamKontakte", payload: BODY }]);
  });

  /* No cached read holds a contact person, so an invalidation here would clear what the replay never moved. */
  it("clears no cached read, whether the replay lands or is refused", async () => {
    invalidated.length = 0;
    await undo(BODY);
    answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, DUPLICATE_KEY)));
    await undo(BODY);

    assert.deepEqual(invalidated, []);
  });

  it("replays nothing for a body the save's schema refuses, or a caller from another site", async () => {
    calls.length = 0;
    const withoutToken = await undo({ ...BODY, kontakte_stand: undefined });
    const crossSite = await undo(BODY, "cross-site");

    assert.equal(withoutToken.success, false);
    assert.equal(crossSite.success, false);
    assert.deepEqual(calls, []);
  });

  /* Three sites per refusal: a code the route's table leaves unmapped falls through to the shared 409
     sentence about an equivalent entry, which says nothing of what became of the change. */
  it("words every refusal the replayed endpoint publishes, closing on what became of the change", async () => {
    for (const code of publishedRefusals(REPLAY_OPERATION)) {
      answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, code)));

      const answer = await undo(BODY);

      assert.equal(answer.success, false, `${code} resolved as a restore`);
      assert.notEqual(answer.error, UNMAPPED, `${code} reaches the admin as an unhandled conflict`);
      assert.match(
        answer.error ?? "",
        /\S\. (?:Die Änderung steht weiterhin|Die Rücknahme wurde nicht ausgeführt, [^.]+)\.$/,
        `${code} leaves the admin guessing what the block now holds`,
      );
    }
  });

  /* The save's own sentence sends the admin to a form this toast has not got. */
  it("words the stale block for the undo, saying why it did not run", async () => {
    answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, "REQ-KONTAKT-001")));

    const answer = await undo(BODY);

    assert.match(answer.error ?? "", /Die Rücknahme wurde nicht ausgeführt, damit die gelöschten Angaben nicht wieder eingetragen werden\.$/);
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
