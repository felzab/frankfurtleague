import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { sliceBetween } from "../../core/refusalRegister.ts";

const FEATURES = path.resolve(import.meta.dirname, "..", "..", "features");

/**
 * Every editor whose undo dispatch reports a throw as copy. `AdminEditSpielDataForm` is absent on
 * purpose: it shows the raw error instead, which its own comment defends.
 */
const EDITORS: Record<string, string> = {
  kontakte: "kontakte/components/forms/AdminKontakteEditForm/AdminKontakteEditForm.tsx",
  saisons: "saisons/components/forms/AdminSaisonEditForm/AdminSaisonEditForm.tsx",
  schiedsrichter: "schiedsrichter/components/forms/AdminSchiedsrichterEditForm/AdminSchiedsrichterEditForm.tsx",
  spieler: "spieler/components/forms/AdminSpielerEditForm/AdminSpielerEditForm.tsx",
  spielorte: "spielorte/components/forms/AdminSpielortEditForm/AdminSpielortEditForm.tsx",
  spieltage: "spieltage/components/forms/AdminSpieltagEditForm/AdminSpieltagEditForm.tsx",
  teams: "teams/components/forms/AdminTeamEditForm/AdminTeamEditForm.tsx",
};

/** The rejection handler alone, cut at the `console.warn` that only a failed dispatch reaches. */
function dispatchFailure(file: string): string {
  const source = readFileSync(path.resolve(FEATURES, file), "utf8");
  return sliceBetween(source, 'console.warn("Undo dispatch failed"', "},");
}

describe("what an undo says when its dispatch never landed", () => {
  /* A rejected dispatch reached no judgement, so the payload cannot be what failed and a reader sent
     to inspect it hunts a fault in fields that are fine. */
  it("blames the transport and nothing the admin was editing", () => {
    for (const [slice, file] of Object.entries(EDITORS)) {
      const handler = dispatchFailure(file);

      assert.ok(handler.length > 0, `${slice}: no dispatch-rejection handler to read`);
      assert.match(
        handler,
        /description: "Die Änderung steht weiterhin\. Prüfe die Verbindung\.",/,
        `${slice}: the transport failure no longer says the one true sentence`,
      );
      // The half that was wrong: whatever noun follows, a failed dispatch judged none of it.
      assert.doesNotMatch(handler, /Prüfe die Verbindung und /, `${slice}: a failed dispatch blames data nothing judged`);
    }
  });

  /* The reading above is only worth what its cut is worth: a handler that stopped being the rejected
     one would pass every case by holding no sentence at all. */
  it("reads the rejected dispatch rather than the answered one", () => {
    for (const [slice, file] of Object.entries(EDITORS)) {
      const handler = dispatchFailure(file);

      assert.match(
        handler,
        /appToast\.danger\("Rücknahme konnte nicht gesendet werden"/,
        `${slice}: the cut no longer lands on the transport toast`,
      );
      assert.ok(!handler.includes("Rücknahme fehlgeschlagen"), `${slice}: the cut reaches into the answered refusal beside it`);
    }
  });
});
