import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* `useRouter` reads a context no `next/navigation` export carries, so the panel is mounted under the
   one Next keeps it on, as `fl_frontend/src/features/kontakte/editor.test.ts` mounts the search params. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";

import { RECORDED_FACTS_ANY } from "@/features/saisons/constants.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

import type { ContextType } from "react";

const { FormSpielplanSection } = await import("./FormSpielplanSection.tsx");

/**
 * Read rather than rendered for the copy this panel spells NOWHERE: a render answers for the one
 * state it was given, and an absence is claimed across every state there is.
 */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, "FormSpielplanSection.tsx"), "utf8");

/**
 * The armed alert alone: the shell's own parts are asserted at `ConfirmReveal`'s home. Read rather
 * than rendered because a second press reveals it, and a static render produces the resting form.
 */
const ARMED = (SOURCE.split("<ConfirmReveal>")[1] ?? "").split("</ConfirmReveal>")[0] ?? "";

/** The armed alert's scope section alone, which is the half the new numbers invalidate. */
const ENTSTEHT = ARMED.split("Daraus entsteht")[1] ?? "";

/** The press handler alone, so an ordering read off it is about the write and not about the markup. */
const HANDLER = (SOURCE.split("const handlePress = () => {")[1] ?? "").split("return (")[0] ?? "";

type SpielplanProps = Parameters<typeof FormSpielplanSection>[0];

/** Every method the panel never calls: it refreshes only after a write, which no static render reaches. */
const ROUTER: NonNullable<ContextType<typeof AppRouterContext>> = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "spielplanReplace",
};

/**
 * A planned season whose rules reach a bracket inside a span long enough for it, which is what leaves
 * the draw open at all; every case below moves it one fact towards the state it is about.
 */
const PANEL: SpielplanProps = {
  saisonId: "2026-27",
  saisonStatus: "future",
  rules: {
    win_points: 3,
    draw_points: 1,
    qualifiers_per_group: 2,
    number_of_groups: 2,
    teams_per_group: 4,
    max_kadergroesse: 18,
    tiebreak_order: "tordifferenz",
    forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
    erlaubte_stufen: ["E1", "Q1"],
  },
  startDate: "2026-08-01",
  endDate: "2027-06-30",
  spielplan: null,
  spieltageCount: 0,
  schedule: [
    { phase: "gruppenphase", matchdays: 3, matches_per_matchday: 4 },
    { phase: "halbfinale", matchdays: 1, matches_per_matchday: 2 },
    { phase: "finale", matchdays: 1, matches_per_matchday: 1 },
  ],
  bestand: { spiele: 0, erfasst: 0, angesetzt: 0 },
  hasDrawnSpiele: false,
  onBeforeWrite: () => true,
};

/** The same season once the generator has run on it, which is the whole of what makes a press a replace. */
const DRAWN: Partial<SpielplanProps> = {
  spielplan: { generiert_am: "2026-07-01", spieltage: 5, spiele: 15 },
  spieltageCount: 5,
  bestand: { spiele: 15, erfasst: 0, angesetzt: 4 },
  hasDrawnSpiele: true,
};

const markup = (props: Partial<SpielplanProps>): string =>
  renderTree(h(AppRouterContext.Provider, { value: ROUTER, children: h(FormSpielplanSection, { ...PANEL, ...props }) }));

/** What a reader meets, tags gone and whitespace collapsed. */
const gelesen = (props: Partial<SpielplanProps>): string =>
  markup(props)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The three shape boxes, counted by the payload path each writes rather than by the label above it. */
const shapeFieldCount = (props: Partial<SpielplanProps>): number => (markup(props).match(/name="shape\.[a-z_]+"/g) ?? []).length;

describe("the draw half of the Spielplan panel", () => {
  /* First, and half the assertions below are `doesNotMatch`, which an empty slice passes silently. */
  it("cuts the armed alert, its scope section and the handler out of the file before reading them", () => {
    assert.ok(ARMED.includes("Daraus entsteht"), "the armed alert's readout is outside its slice");
    assert.ok(ENTSTEHT.includes("<dl"), "the scope section is outside its slice");
    assert.ok(HANDLER.includes("generateSpielplanAction("), "the draw's write is outside the handler's slice");
    assert.ok(!HANDLER.includes("<section"), "the handler's slice runs on into the markup");
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
    assert.equal(shapeFieldCount(DRAWN), 3, "a press replacing a standing draw offers no shape fields");
    assert.equal(shapeFieldCount({}), 0, "a first draw offers numbers it cannot move");
    // A drawn season the window has closed, which holds a draw the press cannot replace: gating on
    // what the season HOLDS rather than on what the press does passes the two states above.
    assert.equal(
      shapeFieldCount({ ...DRAWN, bestand: { spiele: 15, erfasst: 2, angesetzt: 4 } }),
      0,
      "a closed panel offers numbers no press can send",
    );
  });

  /* Leave them live under the confirmation and this fails: the readout the admin agreed to would
     move between the two presses, and the second press sends whatever the fields hold then. */
  it("freezes the three numbers once the control is armed", () => {
    assert.match(SOURCE, /isReadOnly=\{isConfirming \|\| isWriting\}/);
  });

  /* Call the action outside `press` and one press is the whole confirmation, on a write that redraws
     rather than restoring. The arming branch itself is `useTwoPressConfirm`'s to keep. */
  it("sends the write through the two-press control, and announces the armed state", () => {
    const arming = HANDLER.indexOf("press(async () => {");
    const writing = HANDLER.indexOf("generateSpielplanAction(");

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
    const recorded = gelesen({ ...DRAWN, bestand: { spiele: 15, erfasst: 2, angesetzt: 4 } });

    assert.ok(recorded.includes(RECORDED_FACTS_ANY), `the closed panel states a window of its own: ${recorded}`);
    // A literal spelling the shared sentence renders identically, so which of the two stands here is
    // legible in the source alone.
    assert.match(SOURCE, /\{closedReason\}/, "the panel seats a sentence of its own where the shared reason belongs");
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

  /* A first draw on a PLANNED season has a repair, the undraw beside it (`REQ-SPIELPLAN-006`), so a
     permanence claim there sends an admin away from a control this panel offers. The other two
     destroy rows nothing replays. */
  it("points a first draw on a planned season at the undraw, and claims no way back on the other two", () => {
    assert.match(ARMED, /Zurücknehmen lässt sich der Spielplan danach wieder hier/);
    assert.equal(ARMED.match(/Es gibt in der Verwaltung keinen Weg zurück\./g)?.length, 2);
    assert.doesNotMatch(ARMED, /Verwaltung nicht/);
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
    // Both unarmed labels, because a verb copied from the other state is only wrong on one of them.
    assert.match(gelesen(DRAWN), /Spielplan neu anlegen/, "the press over a standing draw does not say it redraws");
    assert.match(gelesen({}), /Spielplan anlegen/, "the first draw does not name what it makes");

    assert.match(SOURCE, /"Ja, löschen und neu anlegen"/);
  });
});
