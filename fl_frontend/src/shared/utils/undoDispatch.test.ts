import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { sliceBetween } from "../../core/refusalRegister.ts";

const FEATURES = path.resolve(import.meta.dirname, "..", "..", "features");
const DISPATCH = readFileSync(path.resolve(import.meta.dirname, "undoDispatch.ts"), "utf8");

/**
 * Every page-owned editor that offers an undo, each dispatching through `offerUndo` to its own
 * route. A `fetch` of an editor's own would regrow the per-editor copy the shared dispatch removed.
 */
const EDITORS: Record<string, string> = {
  kontakte: "kontakte/components/forms/AdminKontakteEditForm/AdminKontakteEditForm.tsx",
  saisons: "saisons/components/forms/AdminSaisonEditForm/AdminSaisonEditForm.tsx",
  schiedsrichter: "schiedsrichter/components/forms/AdminSchiedsrichterEditForm/AdminSchiedsrichterEditForm.tsx",
  spiele: "spiele/components/forms/AdminEditSpielDataForm/AdminEditSpielDataForm.tsx",
  spieler: "spieler/components/forms/AdminSpielerEditForm/AdminSpielerEditForm.tsx",
  spielorte: "spielorte/components/forms/AdminSpielortEditForm/AdminSpielortEditForm.tsx",
  spieltage: "spieltage/components/forms/AdminSpieltagEditForm/AdminSpieltagEditForm.tsx",
  teams: "teams/components/forms/AdminTeamEditForm/AdminTeamEditForm.tsx",
};

/** The rejection handler alone, cut at the `console.warn` that only a failed dispatch reaches. */
const DISPATCH_FAILURE = sliceBetween(DISPATCH, 'console.warn("Undo dispatch failed"', "},");

describe("what the shared undo dispatch says when it never landed", () => {
  /* A rejected dispatch reached no judgement, so the payload cannot be what failed and a reader sent
     to inspect it hunts a fault in fields that are fine. */
  it("blames the transport and nothing the admin was editing", () => {
    assert.ok(DISPATCH_FAILURE.length > 0, "no dispatch-rejection handler to read");
    assert.match(
      DISPATCH_FAILURE,
      /description: "Die Änderung steht weiterhin\. Prüfe die Verbindung\.",/,
      "the transport failure no longer says the one true sentence",
    );
    // The half that was wrong: whatever noun follows, a failed dispatch judged none of it.
    assert.doesNotMatch(DISPATCH_FAILURE, /Prüfe die Verbindung und /, "a failed dispatch blames data nothing judged");
  });

  /* The reading above is only worth what its cut is worth: a handler that stopped being the rejected
     one would pass every case by holding no sentence at all. */
  it("reads the rejected dispatch rather than the answered one", () => {
    assert.match(
      DISPATCH_FAILURE,
      /appToast\.danger\("Rücknahme konnte nicht gesendet werden"/,
      "the cut no longer lands on the transport toast",
    );
    assert.ok(!DISPATCH_FAILURE.includes("Rücknahme fehlgeschlagen"), "the cut reaches into the answered refusal beside it");
  });
});

describe("where each editor's undo dispatches", () => {
  it("rides the shared dispatch to its own route, with no fetch of its own", () => {
    for (const [slice, file] of Object.entries(EDITORS)) {
      const source = readFileSync(path.resolve(FEATURES, file), "utf8");

      assert.ok(source.includes(`endpoint: "/api/admin/${slice}/undo"`), `${slice}: the undo no longer dispatches to the slice's own route`);
      assert.ok(!source.includes("fetch("), `${slice}: the editor spells a dispatch of its own beside the shared one`);
    }
  });
});
