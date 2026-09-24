import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import { doubleActionRequest, doubleActions } from "@/shared/testing/actionDoubles.ts";
import { DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";

/* The real route, called: the request it runs in and the writes it replays are the doubles. */
doubleActionRequest();
registerHooks({
  // `next` publishes no `exports` map, so Node finds the subpath only with the extension a bundler would supply.
  resolve: (specifier, context, nextResolve) => nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context),
});
const { answerWith, calls } = doubleActions({
  modules: ["/src/features/spieler/mutations.ts"],
  answer: () => Promise.resolve({ acknowledged: 1 }),
});
const { POST } = await import("./route.ts");
const { toActionErrorResult } = await import("@/shared/utils/actionError.ts");

/**
 * What `fl_frontend/src/features/spieler/mutations.ts :: patchSaisonSpieler` sends, as the backend's own routes spell
 * it. The person half's `PATCH /spieler/{spieler_id}` publishes no 409.
 */
const SQUAD_OPERATION = "PATCH /spieler/{spieler_id}/saisons/{saison_id}";

const SPIELER_ID = "68c1f0a2b3c4d5e6f7a8b9c0";
const PERSON = { id: SPIELER_ID, vorname: "Lena", nachname: "Meier", geburtsdatum: null };
const SAISON = {
  spieler_id: SPIELER_ID,
  saison_id: "2026",
  team_id: "6890a1b2c3d4e5f607182932",
  nummer: null,
  position: null,
  stufe: null,
  rolle: null,
};

type Outcome = { success: boolean; message?: string; error?: string };

async function undo(body: unknown): Promise<Outcome> {
  const answered = await POST({ headers: new Headers({ "sec-fetch-site": "same-origin" }), json: async () => body } as never);
  return (await answered.json()) as Outcome;
}

/** The person half restored, and the squad half refused with `code`. */
function refuseTheSquadHalf(code: string): void {
  answerWith(() => {
    const call = calls.at(-1)?.action;
    return call === "patchSaisonSpieler" ? Promise.reject(refusedOn(SQUAD_OPERATION, code)) : Promise.resolve({ acknowledged: 1 });
  });
}

describe("the player save's undo", () => {
  it("replays both halves, the person first", async () => {
    calls.length = 0;
    const answer = await undo({ person: PERSON, saison: SAISON });

    assert.equal(answer.success, true, String(answer.error));
    assert.deepEqual(
      calls.map((call) => call.action),
      ["patchSpieler", "patchSaisonSpieler"],
    );
  });

  /* Three sites per refusal: a code the route's table leaves unmapped falls through to the shared 409
     sentence about an equivalent entry, which says nothing of what became of the change. */
  it("words every refusal the squad half publishes, closing on the change standing once", async () => {
    for (const code of publishedRefusals(SQUAD_OPERATION)) {
      refuseTheSquadHalf(code);

      const answer = await undo({ saison: SAISON });

      assert.equal(answer.success, false, `${code} resolved as a restore`);
      assert.match(answer.error ?? "", /\S\. Die Änderung steht weiterhin\.$/, `${code} leaves the admin guessing what the squad now holds`);
      assert.equal(answer.error?.split("Die Änderung steht weiterhin.").length, 2, `${code} states the outcome twice`);
    }
  });

  /* The person half went back first, so the change does not stand whole and the answer may not say it does. */
  it("says only the person half went back where the squad half is refused after it", async () => {
    for (const code of publishedRefusals(SQUAD_OPERATION)) {
      refuseTheSquadHalf(code);

      const answer = await undo({ person: PERSON, saison: SAISON });

      assert.equal(answer.success, false, `${code} resolved as a restore`);
      assert.match(answer.error ?? "", /\S\. Nur die Personendaten wurden zurückgesetzt\.$/, `${code} after the person half`);
      assert.doesNotMatch(answer.error ?? "", /steht weiterhin/, `${code} says the change stands after the person half went back`);
    }
  });

  /* The unique index's refusal keeps the shared reader's own sentence, followed by the outcome as every
     row here is: two spellings of one sentence, held together. */
  it("words the duplicate key as the shared reader does, saying the change stands", async () => {
    refuseTheSquadHalf(DUPLICATE_KEY);

    const answer = await undo({ saison: SAISON });

    assert.equal(answer.error, `${String(toActionErrorResult(refusedOn(SQUAD_OPERATION, DUPLICATE_KEY)).error)} Die Änderung steht weiterhin.`);
  });
});
