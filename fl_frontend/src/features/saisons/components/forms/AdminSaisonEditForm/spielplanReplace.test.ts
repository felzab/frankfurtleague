import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/** Source text rather than a render, `oneWayGuards.test.ts`'s idiom and for its reason. */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, "FormSpielplanSection.tsx"), "utf8");

/** The armed alert alone: the shell's own parts are asserted at `ConfirmReveal`'s home. */
const ARMED = (SOURCE.split("<ConfirmReveal>")[1] ?? "").split("</ConfirmReveal>")[0] ?? "";

/** The armed alert's scope section alone, which is the half the new numbers invalidate. */
const ENTSTEHT = ARMED.split("Daraus entsteht")[1] ?? "";

/** The panel's own hint, which stands in the heading and ends with it. */
const HINWEIS = (SOURCE.split("Hinweis zum Spielplan")[1] ?? "").split("</h2>")[0] ?? "";

describe("the draw half of the Spielplan panel", () => {
  /* First, and half the assertions below are `doesNotMatch`, which an empty slice passes silently. */
  it("cuts the armed alert, its scope section and the hint out of the file before reading them", () => {
    assert.ok(ARMED.includes("Daraus entsteht"), "the armed alert's readout is outside its slice");
    assert.ok(ENTSTEHT.includes("<dl"), "the scope section is outside its slice");
    assert.ok(HINWEIS.includes("points: ["), "the hint's bullets are outside its slice");
  });

  /* Hardcode the flag and this fails: `false` asks for a draw the endpoint refuses, `true` confirms
     a destruction on a season holding nothing. Send the shape always and a first draw claims
     numbers nobody typed. */
  it("sends the replace and the shape it just displayed, rather than constants", () => {
    assert.match(SOURCE, /generateSpielplanAction\(\{ id: saisonId, replace: replacesDraw, shape: replacesDraw \? shape : undefined \}\)/);
  });

  /* Offer the three on a first draw and this fails: an undrawn season has no fixtures to move them
     with, so its numbers stay the rules panel's, where the save bar can still reach them. */
  it("offers the three numbers only where the press replaces a standing draw", () => {
    const offer = SOURCE.indexOf("{isDrawing && replacesDraw && (");
    const fields = SOURCE.indexOf("SHAPE_FIELDS.map");

    assert.ok(offer !== -1, "the panel gates nothing on replacesDraw");
    assert.ok(fields !== -1, "the panel renders no shape fields");
    assert.ok(offer < fields, "the shape fields stand outside the replace branch");
  });

  /* Leave them live under the confirmation and this fails: the readout the admin agreed to would
     move between the two presses, and the second press sends whatever the fields hold then. */
  it("freezes the three numbers once the control is armed", () => {
    assert.match(SOURCE, /isReadOnly=\{isConfirming \|\| isWriting\}/);
  });

  /* Call the action outside `press` and one press is the whole confirmation, on a write that redraws
     rather than restoring. The arming branch itself is `useTwoPressConfirm`'s to keep. */
  it("sends the write through the two-press control, and announces the armed state", () => {
    const arming = SOURCE.indexOf("press(async () => {");
    const writing = SOURCE.indexOf("generateSpielplanAction(");

    assert.ok(arming !== -1, "handlePress no longer presses through useTwoPressConfirm");
    assert.ok(arming < writing, "the write stands outside the armed branch");
    assert.match(SOURCE, /<ConfirmReveal>/);
  });

  /* Read the armed rows off the stored rules again and this fails. The press STORES the numbers, so
     a readout showing where the season already stands hides the whole of what changes. */
  it("reads the armed shape rows off the draft rather than the stored rules", () => {
    assert.match(ARMED, /shapeRows\.map/);
    assert.doesNotMatch(ARMED, /rules\.number_of_groups|rules\.teams_per_group|rules\.qualifiers_per_group/);
  });

  /* State the served scope beside moved numbers and this fails: `schedule` was derived from the
     numbers this press replaces, so the figure would describe a season nobody is about to get. */
  it("withholds the scope readout where the new numbers have moved it", () => {
    const branch = ENTSTEHT.indexOf("isShapeMoved");
    const umfang = ENTSTEHT.indexOf("describeSpielplanUmfang");

    assert.ok(branch !== -1, "the scope readout does not read isShapeMoved at all");
    assert.ok(umfang !== -1, "the scope readout names no Umfang");
    assert.ok(branch < umfang, "the armed alert states a scope derived from the numbers this press replaces");
  });

  /* Drop the sentence and this fails: an admin agreeing to a redraw would find the season's rules
     moved with it, which is exactly the surprise the armed state exists to prevent. */
  it("says that the moved numbers are stored with the draw", () => {
    assert.match(ARMED, /zusammen mit dem Spielplan gespeichert/);
  });

  /* The window is named where it bites, through `blockedReasons.ts`'s shared sentence, and never
     spelled a second time here. The categories themselves are pinned by
     `fl_frontend/src/features/saisons/utils.test.ts`. */
  it("names the window through the shared reason rather than spelling its own list", () => {
    assert.match(SOURCE, /\{closedReason\}/);
    assert.doesNotMatch(SOURCE, /kein Ergebnis/, "the panel spells the recorded-fact list a second time");
  });

  /* Lift the deletion readout out of its branch and a first draw claims to remove matchdays and
     fixtures that do not exist. `holdsADraw` and not `replacesDraw`: the undraw destroys the same
     rows. */
  it("keeps the deletion readout behind the predicate for a season that holds one", () => {
    const branch = ARMED.indexOf("holdsADraw");
    const deletion = ARMED.indexOf("gelöscht");

    assert.ok(branch !== -1, "the armed alert does not read holdsADraw at all");
    assert.ok(deletion !== -1, "the armed alert names no deletion");
    assert.ok(branch < deletion, "the armed alert claims a deletion before it knows the season holds one");
  });

  /* Soften the copy to "der Spielplan wird ersetzt" and this fails. The scheduling is the part an
     admin cannot look up again afterwards, so the armed state has to name it rather than the draw. */
  it("names the matchdays, the fixtures and the scheduling the replace destroys", () => {
    for (const named of [/Spieltage/, /Spiele/, /Termin/, /Uhrzeit/]) {
      assert.match(ARMED, named);
    }
  });

  /* A first draw on a PLANNED season has a repair, the undraw beside it (`REQ-SPIELPLAN-006`), so a
     permanence claim there sends an admin away from a control this panel offers. The other two
     destroy rows nothing replays. */
  it("points a first draw on a planned season at the undraw, and claims no way back on the other two", () => {
    assert.match(ARMED, /Zurücknehmen lässt sich der Spielplan danach wieder hier/);
    assert.equal(ARMED.match(/Es gibt in der Verwaltung keinen Weg zurück\./g)?.length, 2);
    assert.doesNotMatch(ARMED, /Verwaltung nicht/);
  });

  /* Wire an undo here and this fails. `/spiele` has neither a create nor a delete, so nothing can
     write the removed rows back; the action log's images are a record to read, not a restore. */
  it("offers no undo beside the one destructive save that has none", () => {
    assert.doesNotMatch(SOURCE, /actionProps/);
    assert.doesNotMatch(SOURCE, /Rückgängig machen|children: "Rückgängig"/);
  });

  /* A venue or a referee is what `holds_a_recorded_fact` counts, so either CLOSES the replace and no
     season reaching the armed state carries one. Name a booking as a loss again and this fails. */
  it("names no booking among the work the replace destroys", () => {
    assert.doesNotMatch(ARMED, /\bOrte?\b/);
    assert.doesNotMatch(ARMED, /Schiedsrichter/);
  });

  /* Write "noch kein Spiel gewertet" anywhere and this fails: the window closes on anything
     entered, cancellations and bookings included, which that wording understates. */
  it("states the window as nothing entered rather than nothing scored", () => {
    assert.doesNotMatch(SOURCE, /noch kein Spiel gewertet/);
    assert.match(SOURCE, /zu keinem ihrer\s+Spiele\s+etwas\s+eingetragen wurde/);
  });

  /* Write "genau einmal" anywhere in the panel and this fails: inside `REQ-SPIELPLAN-005`'s window
     the draw runs as often as the rules need correcting. */
  it("makes no claim that a season is drawn exactly once", () => {
    assert.doesNotMatch(SOURCE, /genau einmal/);
  });

  /* Leave the armed label at "Ja, Spielplan anlegen" and this fails: the destructive press would
     read exactly like the additive one at the moment it is pressed. */
  it("names the deletion on the armed button, not just in the prose above it", () => {
    assert.match(SOURCE, /"Ja, löschen und neu anlegen"/);
    assert.match(SOURCE, /"Spielplan neu anlegen"/);
  });
});
