import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";

import { APINetworkError } from "@/core/errors.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { toActionErrorResult } from "@/shared/utils/actionError.ts";

import type { FLSpielAdmin } from "@/features/spiele/schemas.ts";

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

const { calls } = doubleActions({ modules: ["/src/features/spiele/actions.ts"], answer: () => Promise.resolve(STALLED_PREVIEW) });

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

describe("the match editor's preview when its dry run times out", () => {
  /* A preview is an extra that never blocks a save, so an unanswered one adds nothing to the page: no
     fixture named as losing its result, and no sentence saying a write may have landed. */
  it("names no fixture and no unknown outcome", async (t) => {
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
    assert.deepEqual(raised, [], "the unanswered preview raised a toast");
    assert.equal(screen.queryAllByText(/Speichern löscht|entfernt/).length, 0, "an unanswered preview names a fixture");
    assert.equal(screen.queryAllByText(/ist unklar/).length, 0, "a read that stored nothing is worded as a write that may stand");
  });
});
