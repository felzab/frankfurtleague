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
  modules: ["/src/features/teams/mutations.ts"],
  answer: () => Promise.resolve({ acknowledged: 1 }),
});
const { POST } = await import("./route.ts");
const { toActionErrorResult } = await import("@/shared/utils/actionError.ts");

/** What `fl_frontend/src/features/teams/mutations.ts :: patchTeam` sends, as the backend's own routes spell it. */
const CLUB_OPERATION = "PATCH /teams/{team_id}";
/** What `fl_frontend/src/features/teams/mutations.ts :: patchSaisonTeam` sends. */
const JUNCTION_OPERATION = "PATCH /teams/{team_id}/saisons/{saison_id}";

const TEAM_ID = "6890a1b2c3d4e5f607182932";
const CLUB = {
  id: TEAM_ID,
  name: "SG Alpha",
  shorthand: "SA",
  description: "",
  full_name: "Sportgemeinschaft Alpha",
  website_url: null,
  address: { strasse: "Am Sportpark", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" },
  schulform: null,
};
const SAISON = { team_id: TEAM_ID, saison_id: "2026", gruppe: "A", austritt: null, trikot_farbe: null };

type Outcome = { success: boolean; message?: string; error?: string };

async function undo(body: unknown): Promise<Outcome> {
  const answered = await POST({ headers: new Headers({ "sec-fetch-site": "same-origin" }), json: async () => body } as never);
  return (await answered.json()) as Outcome;
}

/** `action` refused with `code` as `operation` raises it, every other write restored. */
function refuse(action: "patchTeam" | "patchSaisonTeam", operation: string, code: string): void {
  answerWith(() => (calls.at(-1)?.action === action ? Promise.reject(refusedOn(operation, code)) : Promise.resolve({ acknowledged: 1 })));
}

const CHANGE_STANDS = /\S\. Die Änderung steht weiterhin\.$/;

describe("the team save's undo", () => {
  it("replays both halves, the club first", async () => {
    calls.length = 0;
    const answer = await undo({ club: CLUB, saison: SAISON });

    assert.equal(answer.success, true, String(answer.error));
    assert.deepEqual(
      calls.map((call) => call.action),
      ["patchTeam", "patchSaisonTeam"],
    );
  });

  /* Three sites per refusal: a code the route's table leaves unmapped falls through to the shared 409
     sentence about an equivalent entry, which says nothing of what became of the change. */
  it("words every refusal the club half publishes, closing on the change standing once", async () => {
    for (const code of publishedRefusals(CLUB_OPERATION)) {
      refuse("patchTeam", CLUB_OPERATION, code);

      const answer = await undo({ club: CLUB, saison: SAISON });

      assert.equal(answer.success, false, `${code} resolved as a restore`);
      assert.match(answer.error ?? "", CHANGE_STANDS, `${code} on the club half leaves the admin guessing what the team now holds`);
      assert.equal(answer.error?.split("Die Änderung steht weiterhin.").length, 2, `${code} states the outcome twice`);
    }
  });

  it("words every refusal the junction half publishes, closing on the change standing once", async () => {
    for (const code of publishedRefusals(JUNCTION_OPERATION)) {
      refuse("patchSaisonTeam", JUNCTION_OPERATION, code);

      const answer = await undo({ saison: SAISON });

      assert.equal(answer.success, false, `${code} resolved as a restore`);
      assert.match(answer.error ?? "", CHANGE_STANDS, `${code} on the junction leaves the admin guessing what the team now holds`);
      assert.equal(answer.error?.split("Die Änderung steht weiterhin.").length, 2, `${code} states the outcome twice`);
    }
  });

  /* The club half went back first, so the change does not stand whole and the answer may not say it does. */
  it("says only the club half went back where the junction is refused after it", async () => {
    for (const code of publishedRefusals(JUNCTION_OPERATION)) {
      refuse("patchSaisonTeam", JUNCTION_OPERATION, code);

      const answer = await undo({ club: CLUB, saison: SAISON });

      assert.equal(answer.success, false, `${code} resolved as a restore`);
      assert.match(answer.error ?? "", /\S\. Nur die Stammdaten wurden zurückgesetzt\.$/, `${code} after the club half`);
      assert.doesNotMatch(answer.error ?? "", /steht weiterhin/, `${code} says the change stands after the club half went back`);
    }
  });

  /* The unique index's refusal keeps the shared reader's own sentence, followed by the outcome as every
     row here is: two spellings of one sentence, held together. */
  it("words the duplicate key as the shared reader does on either half, saying the change stands", async () => {
    for (const [action, operation] of [
      ["patchTeam", CLUB_OPERATION],
      ["patchSaisonTeam", JUNCTION_OPERATION],
    ] as const) {
      refuse(action, operation, DUPLICATE_KEY);

      const answer = await undo(action === "patchTeam" ? { club: CLUB } : { saison: SAISON });

      assert.equal(
        answer.error,
        `${String(toActionErrorResult(refusedOn(operation, DUPLICATE_KEY)).error)} Die Änderung steht weiterhin.`,
        action,
      );
    }
  });
});
