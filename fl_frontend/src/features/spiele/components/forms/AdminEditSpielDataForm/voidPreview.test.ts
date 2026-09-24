import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";

import { APINetworkError } from "@/core/errors.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { toActionErrorResult } from "@/shared/utils/actionError.ts";

import type { FLSpielAdmin } from "@/features/spiele/schemas.ts";
import type { TestContext } from "node:test";

/* The dry run's transport timed out, answered as `runAdminMutation` answers the preview's read-only
   declaration: the transport marks the PATCH read-only, so nothing may read it as a write that stands. */
const STALLED_PREVIEW = toActionErrorResult(
  new APINetworkError({
    message: "timed out",
    url: "http://localhost/api/v0/spiele/6890a1b2c3d4e5f607182901?dry_run=true",
    method: "PATCH",
    readOnly: true,
    traceId: "0",
    isTimeout: true,
  }),
  { method: "POST", readOnly: true },
);

const { calls, answerWith } = doubleActions({ modules: ["/src/features/spiele/actions.ts"], answer: () => Promise.resolve(STALLED_PREVIEW) });

const { raised } = doubleToasts();

const { AdminEditSpielDataForm } = await import("./AdminEditSpielDataForm.tsx");

const SPIELTAG_ID = "6890a1b2c3d4e5f607182990";

const side = (team_id: string, name: string, shorthand: string) => ({ team_id, tore: null, name, shorthand, austritt_type: null });

const spiel = (id: string, spiel_nr: number, team1: ReturnType<typeof side>, team2: ReturnType<typeof side>): FLSpielAdmin => ({
  id,
  spieltag_id: SPIELTAG_ID,
  team1,
  team2,
  team1_quelle: null,
  team2_quelle: null,
  datum: null,
  uhrzeit: null,
  ort: null,
  schiedsrichter: null,
  ergebnis: null,
  elfmeterschiessen: null,
  spiel_nr,
  sonderereignis: null,
  saison_phase: "gruppenphase",
  saison_id: "2026",
  notiz: null,
});

const EDITED = spiel(
  "6890a1b2c3d4e5f607182901",
  1,
  side("68c1f0a2b3c4d5e6f7a8b9c1", "SG Alpha", "SA"),
  side("68c1f0a2b3c4d5e6f7a8b9c2", "SG Beta", "SB"),
);

// A second fixture of the same Spieltag fields two teams, which is what makes the editor ask the dry run at all.
const NEIGHBOUR = spiel(
  "6890a1b2c3d4e5f607182902",
  2,
  side("68c1f0a2b3c4d5e6f7a8b9c3", "SG Gamma", "SG"),
  side("68c1f0a2b3c4d5e6f7a8b9c4", "SG Delta", "SD"),
);

/** The editor over EDITED, whose Spieltag neighbour is what makes it ask the dry run, with every queued timer run. */
async function renderAndPreview(t: TestContext): Promise<void> {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  render(
    underNext(
      h(AdminEditSpielDataForm, {
        spielData: EDITED,
        teams: [],
        spielorte: [],
        schiedsrichter: [],
        saisonSpiele: [EDITED, NEIGHBOUR],
        numberOfGroups: 2,
        isFinishedSaison: false,
        today: "2026-09-14",
        categorize: () => new Set<never>(),
        pageHeader: { title: "Spiel 1" },
      }),
      { search: "saison_id=2026" },
    ),
  );

  // Every timer the render queued, the preview's debounce among them, then the answer it asked for.
  await act(async () => t.mock.timers.runAll());
  assert.deepEqual(
    calls.map((call) => call.action),
    ["previewAdminSpielDataAction"],
    "the editor never asked the dry run, so nothing below is judged",
  );
}

const UNGEPRUEFT = "Ob Spiele dadurch entfallen, konnte nicht geprüft werden.";

describe("the match editor's preview when its dry run is not answered", () => {
  beforeEach(() => {
    calls.length = 0;
    raised.length = 0;
  });

  /* An empty rail reads as a save that voids nothing, which an unanswered preview never said, so it
     says it could not check; and it names no fixture and no write that may have landed. */
  for (const [how, answer] of [
    ["times out", () => Promise.resolve(STALLED_PREVIEW)],
    // A cut request rejects the action, and from the debounce's timer nothing else answers that.
    ["is cut", () => Promise.reject(new Error("An unexpected response was received from the server."))],
  ] as const) {
    it(`says it could not check, and names no fixture, when the dry run ${how}`, async (t) => {
      answerWith(answer);
      await renderAndPreview(t);

      assert.ok(screen.queryAllByText(UNGEPRUEFT).length > 0, "the unanswered preview left the rail silent");
      assert.deepEqual(raised, [], "the unanswered preview raised a toast");
      assert.equal(
        screen.queryAllByText(/Speichern löscht|entfernt|kein Spiel|keine Spiele/).length,
        0,
        "an unanswered preview names a fixture, or none",
      );
      assert.equal(screen.queryAllByText(/ist unklar/).length, 0, "a read that stored nothing is worded as a write that may stand");
    });
  }

  /* The line is the failure's alone: a preview that answered with nothing voided has checked. */
  it("says nothing about checking when the dry run answered that nothing is voided", async (t) => {
    answerWith(() => Promise.resolve({ success: true, voidedFixtures: [], releasedFixtures: [] }));
    await renderAndPreview(t);

    assert.equal(screen.queryAllByText(UNGEPRUEFT).length, 0, "a preview that answered is worded as one that could not check");
  });
});
