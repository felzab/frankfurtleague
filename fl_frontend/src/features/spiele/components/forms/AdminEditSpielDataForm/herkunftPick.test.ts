import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/** Source text rather than a render, `sonderereignisPick.test.ts`'s idiom and for its reason. */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, "FormTeamPicker.tsx"), "utf8");

/** The rule's other half: the picker drops the row, and the editor feeds the banner saying why. */
const EDITOR = readFileSync(path.resolve(import.meta.dirname, "AdminEditSpielDataForm.tsx"), "utf8");

describe("the Herkunft picker's group placing", () => {
  /* A bracket of four opens at the Halbfinale and one of sixteen at the Achtelfinale, so a rule
     spelling a round would be wrong for one of the two. */
  it("keys off the season's own rounds rather than a phase name", () => {
    assert.match(SOURCE, /isFirstKnockoutRound\(saisonSpiele, spielData\)/);
    assert.doesNotMatch(SOURCE, /"(achtelfinale|viertelfinale|halbfinale|finale)"/);
  });

  /* The round the bracket opens on is the one with no feeder, so the clause listing the match
     sources decides this one read the other way round. */
  it("lists the row only where a group placing may seed the round", () => {
    assert.match(SOURCE, /item\.key === "gruppe" \? seedsFromTheGroups : feederSpiele\.length > 0/);
  });

  /* Gone rather than closed: an answer out of reach on every round after the first is a row with no
     use, and the banner beneath carries the reason for the one fixture that still holds one. */
  it("renders no closed row and no reason beside one", () => {
    assert.doesNotMatch(SOURCE, /refusal:/);
    assert.ok(!SOURCE.includes("nur in der ersten KO-Runde"), "a row still names the round");

    /* The team picker is the file's only list that closes a row, so a second `disabledKeys` is the
       greyed group placing back by the other route. */
    const closedLists = [...SOURCE.matchAll(/disabledKeys=\{(.+?)\}/g)].map(([, keys]) => keys);

    assert.deepEqual(closedLists, ["disabledTeamKeys"], "a Herkunft row is closed rather than absent");
  });

  /* The list is a rendering, and a keyboard pick or a list a render old reaches past what it shows. */
  it("re-reads the list on the pick", () => {
    assert.match(SOURCE, /availableChoices\.find\(\(item\) => item\.key === \(key\?\.toString\(\) \?\? "manuell"\)\)/);
  });

  /* The side's readout, never an offer: listed while it IS the choice and gone the moment the choice
     moves, so re-picking it can only re-send the value `REQ-WIRING-002` already takes back. */
  it("keeps the row for a side that already holds one", () => {
    assert.match(SOURCE, /QUELLE_CHOICES\.filter\(\s*\(item\) => item\.key === "manuell" \|\| item\.key === choice \|\|/);
  });

  /* `REQ-WIRING-002` refuses a save that moves a source into the shape, whatever the fixture already
     stores, so a derivation reading the stored value would reopen the controls below. */
  it("keeps the derivation off the stored source", () => {
    assert.match(SOURCE, /const seedsFromTheGroups = isFirstKnockoutRound\(saisonSpiele, spielData\);/);
    assert.doesNotMatch(SOURCE, /seedsFromTheGroups = .*storedQuelle/);
  });

  /* The absent row decides only the TYPE. Left open, the group and the placing each offer a change
     to the very shape the endpoint refuses. */
  it("closes the group and the placing for a side wired past that round", () => {
    const disabled = [...SOURCE.matchAll(/isDisabled=\{!seedsFromTheGroups\}/g)];

    assert.equal(disabled.length, 2, "the group or the placing control stays open");
  });

  /* Closed, not dropped: the stored placing is the only readout of what this side is wired to, and
     an admin who cannot see it cannot tell which repair to make. */
  it("keeps the stored placing on screen while it is closed", () => {
    assert.match(SOURCE, /quelle\?\.type === "gruppe" && \(/);
    assert.match(SOURCE, /name=\{`\$\{fieldName\}_quelle\.platz`\}/);
  });

  /* The two controls under the row carry no reason of their own, and the row itself is gone, so the
     rule stands where the reader meets it. */
  it("carries a banner at the source control", () => {
    assert.match(SOURCE, /spot=\{`\$\{fieldName\}-herkunft`\}/);
  });

  /* One derivation behind both, or the picker closes a control the banner beneath it denies is
     closed at all. */
  it("feeds that banner the derivation the picker closes on", () => {
    assert.match(EDITOR, /seedsFromTheGroups: isFirstKnockoutRound\(saisonSpiele, spielData\)/);
  });
});
