import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Source text rather than a render, `oneWayGuards.test.ts`'s idiom and for its reason: the repository
 * has no DOM runner, and every claim below is about copy and branching inside one `.tsx` no exported
 * value carries.
 */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, "FormSpielplanSection.tsx"), "utf8");

/**
 * The armed alert alone: from the heading it opens with to the button row that follows it. Anchored
 * on the copy rather than on `role="alert"`, which the comment above the alert also names.
 */
const ARMED = (SOURCE.split("Bist Du Dir sicher?")[1] ?? "").split("flex-row flex-wrap items-center")[0] ?? "";

/** The armed alert's scope section alone, which is the half the new numbers invalidate. */
const ENTSTEHT = ARMED.split("Daraus entsteht")[1] ?? "";

/** The panel's own hint, where the conditions on a replace are spelled out for a reader. */
const HINWEIS = (SOURCE.split("Hinweis zum Spielplan")[1] ?? "").split("</InfoHint>")[0] ?? "";

describe("the draw panel's destructive confirmation", () => {
  /* Hardcode the flag and this fails: `false` asks for a draw the endpoint refuses, `true` confirms
     a destruction on a season holding nothing. Send the shape always and a first draw claims
     numbers nobody typed. */
  it("sends the replace and the shape it just displayed, rather than constants", () => {
    assert.match(SOURCE, /generateSpielplanAction\(\{ id: saisonId, replace: replacesDraw, shape: replacesDraw \? shape : undefined \}\)/);
  });

  /* Offer the three on a first draw and this fails: an undrawn season has no fixtures to move them
     with, so its numbers stay the rules panel's, where the save bar can still reach them. */
  it("offers the three numbers only where the press replaces a standing draw", () => {
    const offer = SOURCE.indexOf("{replacesDraw && (");
    const fields = SOURCE.indexOf("SHAPE_FIELDS.map");

    assert.ok(offer !== -1, "the panel gates nothing on replacesDraw");
    assert.ok(fields !== -1, "the panel renders no shape fields");
    assert.ok(offer < fields, "the shape fields stand outside the replace branch");
  });

  /* Leave them live under the confirmation and this fails: the readout the admin agreed to would
     move between the two presses, and the second press sends whatever the fields hold then. */
  it("freezes the three numbers once the control is armed", () => {
    assert.match(SOURCE, /isReadOnly=\{isConfirming \|\| isGenerating\}/);
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

  /* Short by one and this fails. Every category `holds_a_recorded_fact` counts closes the replace,
     and a hint listing three of four sends an admin hunting a result their note is holding shut. */
  it("names every category that closes the replace, the note included", () => {
    for (const kind of [/kein Ergebnis/, /kein Ausfall/, /kein Ort/, /kein Schiedsrichter/, /keine Notiz/]) {
      assert.match(HINWEIS, kind);
    }
  });

  /* Lift the deletion copy out of its branch and this fails: a first draw would then claim to remove
     matchdays and fixtures that do not exist, which is the inverse of the mistake worth avoiding. */
  it("keeps the deletion sentence behind the replace branch", () => {
    const branch = ARMED.indexOf("replacesDraw");
    const deletion = ARMED.indexOf("gelöscht");

    assert.ok(branch !== -1, "the armed alert does not read replacesDraw at all");
    assert.ok(deletion !== -1, "the armed alert names no deletion");
    assert.ok(branch < deletion, "the armed alert claims a deletion before it knows the press replaces");
  });

  /* Soften the copy to "der Spielplan wird ersetzt" and this fails. The scheduling is the part an
     admin cannot look up again afterwards, so the armed state has to name it rather than the draw. */
  it("names the matchdays, the fixtures and the scheduling the replace destroys", () => {
    for (const named of [/Spieltage/, /Spiele/, /Termin/, /Uhrzeit/]) {
      assert.match(ARMED, named);
    }
  });

  /* Drop the claim from either branch and this fails. Both presses are permanent — a replace redraws
     rather than restoring — so neither may be armed without saying so. */
  it("states on both branches that the admin cannot take the write back", () => {
    assert.equal(ARMED.match(/Verwaltung nicht/g)?.length, 2);
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

  /* Restore "noch kein Spiel gewertet" anywhere and this fails: the window closes on anything
     entered, cancellations and bookings included, which that sentence understates. */
  it("states the window as nothing entered rather than nothing scored", () => {
    assert.doesNotMatch(SOURCE, /noch kein Spiel gewertet/);
    assert.match(SOURCE, /zu keinem ihrer Spiele etwas\s+eingetragen wurde/);
  });

  /* Reinstate the old sentence anywhere in the panel and this fails: inside `REQ-SPIELPLAN-005`'s
     window the draw runs as often as the rules need correcting. */
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
