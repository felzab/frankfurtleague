import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/** Source text rather than a render, `sonderereignisPick.test.ts`'s idiom and for its reason. */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, "FormTeamPicker.tsx"), "utf8");

describe("the Herkunft picker's group placing", () => {
  /* A bracket of four opens at the Halbfinale and one of sixteen at the Achtelfinale, so a rule
     spelling a round would be wrong for one of the two. */
  it("closes off the season's own rounds rather than a phase name", () => {
    assert.match(SOURCE, /isFirstKnockoutRound\(saisonSpiele, spielData\)/);
    assert.doesNotMatch(SOURCE, /"(achtelfinale|viertelfinale|halbfinale|finale)"/);
  });

  /* The one round that must offer it outright is also the one with no feeder to keep it listed, so
     the list's own clause for it is what the offer rests on. */
  it("stays in the list whatever the round holds", () => {
    assert.match(SOURCE, /item\.key === "manuell" \|\| item\.key === "gruppe" \|\|/);
  });

  /* Gone, the row reads as a product that never offered the answer; disabled, it says which round
     does. `FormSonderereignisSection` settles the same question the same way. */
  it("stays listed and disabled, carrying its reason", () => {
    assert.match(SOURCE, /refusal: item\.key === "gruppe" && !seedsFromTheGroups/);
    assert.match(SOURCE, /disabledKeys=\{refusedQuelleKeys\}/);
    assert.ok(SOURCE.includes("nur in der ersten KO-Runde"), "the closed row names no round");
  });

  /* The disabled row is a rendering, and a keyboard pick or a list a render old goes past it. */
  it("re-reads the refusal on the pick", () => {
    assert.match(SOURCE, /pickIfOffered\(quelleOptions, key\?\.toString\(\) \?\? "manuell"\)/);
  });

  /* A later round wired to a group placing by hand has to stay editable, or the narrowing strands
     the fixture in a source its own form will not show. */
  it("leaves a side that already holds one able to keep it", () => {
    assert.match(SOURCE, /isFirstKnockoutRound\(saisonSpiele, spielData\) \|\| storedQuelle\?\.type === "gruppe"/);
  });
});
