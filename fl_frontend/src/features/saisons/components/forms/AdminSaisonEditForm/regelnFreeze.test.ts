import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Source text rather than a render: the repository has no DOM runner, and what is claimed here is
 * which fact closes a control, which no exported value carries.
 */
function sectionSource(file: string): string {
  return readFileSync(path.resolve(import.meta.dirname, file), "utf8");
}

const REGELN = sectionSource("FormRegelnSection.tsx");
const EDIT_FORM = sectionSource("AdminSaisonEditForm.tsx");
const SWAP = sectionSource("FormGruppenSwapSection.tsx");

/** The one expression the season's played knockout fixtures are graded through, on either panel. */
const PLAYED_KNOCKOUT = "swap.playedKnockoutSpiele > 0";

describe("the rules panel's tiebreak freeze", () => {
  /* The floor for every case below, each of which would otherwise pass or fail over a file that
     has been renamed out from under this test rather than over what it claims. */
  it("reads each panel out of its file before asserting over it", () => {
    assert.ok(REGELN.includes("SaisonTiebreakSelect"), "the rules panel no longer holds the tiebreak control");
    assert.ok(EDIT_FORM.includes("<FormRegelnSection"), "the edit form no longer renders the rules panel");
    assert.ok(SWAP.includes("export function FormGruppenSwapSection"), "the swap panel, which shares this fact, is somewhere else now");
  });

  /* `REQ-RULES-012` refuses the change outright, so a control still offering it would take a typed
     value the save then throws away. Both freezes close this one control. */
  it("closes the control on a started knockout as well as on a finished season", () => {
    assert.ok(REGELN.includes("isDisabled={isFinishedSaison || isKnockoutStarted}"), "the tiebreak control is open on a started knockout");
  });

  /* THE COUPLING. ONE derivation of "a knockout fixture has been played" reaches both panels, and
     the endpoint counts that fact once over `has_taken_place` — so a form grading it one way while
     the write path grades it the other is the state this rules out. */
  it("takes the fact from the same count the group swap closes on", () => {
    assert.ok(EDIT_FORM.includes(`isKnockoutStarted={${PLAYED_KNOCKOUT}}`), "the rules panel is handed a fact of its own");
    assert.ok(SWAP.includes(PLAYED_KNOCKOUT), "the swap panel reads the knockout count some other way");

    // Nothing to derive it FROM either: a fixture list reaching this panel would be a second reading.
    assert.doesNotMatch(REGELN, /playedKnockoutSpiele|hasTakenPlace/, "the rules panel derives the freeze itself");
  });

  /* A closed control still has to say why it is closed, and only while the season runs: a finished
     one is answered by the standing banner this panel already carries. */
  it("names the rule behind the closure, and leaves a finished season to its own banner", () => {
    assert.ok(REGELN.includes("{isKnockoutStarted && !isFinishedSaison && ("), "the closure is unexplained, or explained twice over");
    assert.match(REGELN, /Nach dem Beginn der KO-Runde/);
  });
});
