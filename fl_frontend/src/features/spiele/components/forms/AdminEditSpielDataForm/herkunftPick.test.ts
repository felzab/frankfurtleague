import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/** Source text rather than a render, `sonderereignisPick.test.ts`'s idiom and for its reason. */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, "FormTeamPicker.tsx"), "utf8");

/** The rule's other half: the picker closes the control, and the editor feeds the banner saying why. */
const EDITOR = readFileSync(path.resolve(import.meta.dirname, "AdminEditSpielDataForm.tsx"), "utf8");

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

  /* `REQ-WIRING-002` refuses a save that moves a source into the shape, whatever the fixture already
     stores, so keeping the row takeable would offer a change no save can land. */
  it("closes the row for a side that already holds one", () => {
    assert.match(SOURCE, /const seedsFromTheGroups = isFirstKnockoutRound\(saisonSpiele, spielData\);/);
    assert.doesNotMatch(SOURCE, /seedsFromTheGroups = .*storedQuelle/);
  });

  /* The row above being closed decides only the TYPE. Left open, the group and the placing each
     offer a change to the very shape the endpoint refuses. */
  it("closes the group and the placing with the row that chose them", () => {
    const disabled = [...SOURCE.matchAll(/isDisabled=\{!seedsFromTheGroups\}/g)];

    assert.equal(disabled.length, 2, "the group or the placing control stays open");
  });

  /* Closed, not dropped: the stored placing is the only readout of what the side is wired to, and
     an admin who cannot see it cannot tell which repair to make. */
  it("keeps the stored placing on screen while it is closed", () => {
    assert.match(SOURCE, /quelle\?\.type === "gruppe" && \(/);
    assert.match(SOURCE, /name=\{`\$\{fieldName\}_quelle\.platz`\}/);
  });

  /* The row's own reason sits inside a popover and the two controls under it carry none, so the rule
     they close on stands where the reader meets them. */
  it("carries a banner at the source control", () => {
    assert.match(SOURCE, /spot=\{`\$\{fieldName\}-herkunft`\}/);
  });

  /* One derivation behind both, or the picker closes a control the banner beneath it denies is
     closed at all. */
  it("feeds that banner the derivation the picker closes on", () => {
    assert.match(EDITOR, /seedsFromTheGroups: isFirstKnockoutRound\(saisonSpiele, spielData\)/);
  });
});
