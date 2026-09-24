import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import { doubleActionRequest, doubleActions } from "@/shared/testing/actionDoubles.ts";
import { publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";

/* The real route, called: the request it runs in and the write it replays are the doubles. */
doubleActionRequest();
registerHooks({
  // `next` publishes no `exports` map, so Node finds the subpath only with the extension a bundler would supply.
  resolve: (specifier, context, nextResolve) => nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context),
});
const { answerWith, calls } = doubleActions({
  modules: ["/src/features/saisons/mutations.ts"],
  answer: () => Promise.resolve({ acknowledged: 1 }),
});
const { POST } = await import("./route.ts");

/** What `fl_frontend/src/features/saisons/mutations.ts :: patchSaison` sends, as the backend's own routes spell it. */
const REPLAY_OPERATION = "PATCH /saisons/{saison_id}";

const RULES = {
  win_points: 3,
  draw_points: 1,
  qualifiers_per_group: 2,
  number_of_groups: 2,
  teams_per_group: 4,
  max_kadergroesse: 18,
  tiebreak_order: "tordifferenz",
  forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
  erlaubte_stufen: ["E1", "Q1"],
};

/** The pre-save season the press replays, as the editor builds it. */
const BODY = { id: "2026", start_date: "2026-03-01", end_date: "2026-07-01", rules: RULES, bewerbung: null, registrierung: null };

type Outcome = { success: boolean; message?: string; error?: string };

async function undo(body: unknown): Promise<Outcome> {
  const answered = await POST({ headers: new Headers({ "sec-fetch-site": "same-origin" }), json: async () => body } as never);
  return (await answered.json()) as Outcome;
}

describe("the season save's undo", () => {
  it("replays the stored season", async () => {
    calls.length = 0;
    const answer = await undo(BODY);

    assert.equal(answer.success, true, String(answer.error));
    assert.deepEqual(
      calls.map((call) => call.action),
      ["patchSaison"],
    );
  });

  /* Three sites per refusal: a code the route's table leaves unmapped falls through to the shared 409
     sentence about an equivalent entry, which says nothing of what became of the change. */
  it("words every refusal the replayed endpoint publishes, closing on the change standing once", async () => {
    for (const code of publishedRefusals(REPLAY_OPERATION)) {
      answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, code)));

      const answer = await undo(BODY);

      assert.equal(answer.success, false, `${code} resolved as a restore`);
      assert.match(answer.error ?? "", /\S\. Die Änderung steht weiterhin\.$/, `${code} leaves the admin guessing what the season now holds`);
      assert.equal(answer.error?.split("Die Änderung steht weiterhin.").length, 2, `${code} states the outcome twice`);
    }
  });
});
