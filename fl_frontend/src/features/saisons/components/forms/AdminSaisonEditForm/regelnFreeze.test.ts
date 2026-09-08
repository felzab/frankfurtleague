import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { renderTree } from "@/shared/testing/renderTest.ts";
import { deriveDraftStatus } from "@/shared/utils/draftStatus.ts";

const { FormRegelnSection } = await import("./FormRegelnSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");

/**
 * Read rather than rendered: what the three carry between them is WHICH file derives the freeze, and
 * markup reports a closed control without saying which side of the wiring decided it.
 */
function sectionSource(file: string): string {
  return readFileSync(path.resolve(import.meta.dirname, file), "utf8");
}

const REGELN = sectionSource("FormRegelnSection.tsx");
const EDIT_FORM = sectionSource("AdminSaisonEditForm.tsx");
const SWAP = sectionSource("FormGruppenSwapSection.tsx");

/** The one expression the season's played knockout fixtures are graded through, on either panel. */
const PLAYED_KNOCKOUT = "swap.playedKnockoutSpiele > 0";

/** No descriptor for any of these paths, which is the state the panel stands in until a save judges one. */
const STATUS = deriveDraftStatus<null, string>({ descriptors: [], stored: null, draft: null, fieldErrors: {} });

type RegelnProps = Parameters<typeof FormRegelnSection>[0];

/** A season neither freeze reaches, which every case below moves one flag away from. */
const PANEL: RegelnProps = {
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
  onRulesChange: () => undefined,
  onFieldLeft: () => undefined,
  onStufenChange: () => undefined,
  isFinishedSaison: false,
  isKnockoutStarted: false,
  isDrawnSaison: false,
  spielplanWindow: "open",
  banners: [],
};

const markup = (props: Partial<RegelnProps>): string =>
  renderTree(h(DraftStatusProvider, { status: STATUS, children: h(FormRegelnSection, { ...PANEL, ...props }) }));

/**
 * The opening tag of the `<select>` react-aria mirrors the tiebreak picker into, named by the payload
 * path it writes: the panel's other closed controls wear the same attribute, so a count would answer
 * for whichever of them moved.
 */
const tiebreakTag = (props: Partial<RegelnProps>): string => /<select [^>]*name="rules\.tiebreak_order"[^>]*>/.exec(markup(props))?.[0] ?? "";

describe("the rules panel's tiebreak freeze", () => {
  /* The floor for every case below: half of them are `doesNotMatch`, which a panel that rendered no
     control at all — or a file renamed out from under this test — passes in silence. */
  it("renders the tiebreak control, and reads the two coupled panels out of their files", () => {
    assert.notEqual(tiebreakTag({}), "", "the rules panel renders no tiebreak control");
    // A hand-written `select` renders the same opening tag, so only the source says the panel seats
    // the shared picker rather than a control of its own.
    assert.ok(REGELN.includes("SaisonTiebreakSelect"), "the rules panel spells a tiebreak control of its own");
    assert.ok(EDIT_FORM.includes("<FormRegelnSection"), "the edit form no longer renders the rules panel");
    assert.ok(SWAP.includes("export function FormGruppenSwapSection"), "the swap panel, which shares this fact, is somewhere else now");
  });

  /* `REQ-RULES-012` refuses the change outright, so a control still offering it would take a typed
     value the save then throws away. */
  it("closes the control on a started knockout as well as on a finished season", () => {
    assert.doesNotMatch(tiebreakTag({}), /\sdisabled=""/, "the control is closed on a season neither freeze reaches");
    // Every state, because either freeze alone closes it: a control answering to one flag is correct
    // in three of the four.
    assert.match(tiebreakTag({ isKnockoutStarted: true }), /\sdisabled=""/, "the tiebreak control is open on a started knockout");
    assert.match(tiebreakTag({ isFinishedSaison: true }), /\sdisabled=""/, "the tiebreak control is open on a finished season");
    assert.match(tiebreakTag({ isKnockoutStarted: true, isFinishedSaison: true }), /\sdisabled=""/, "the two freezes cancel each other");
  });

  /* THE COUPLING. ONE derivation of "a knockout fixture has been played" reaches both panels, and
     the endpoint counts that fact once over `has_taken_place`. */
  it("takes the fact from the same count the group swap closes on", () => {
    assert.ok(EDIT_FORM.includes(`isKnockoutStarted={${PLAYED_KNOCKOUT}}`), "the rules panel is handed a fact of its own");
    assert.ok(SWAP.includes(PLAYED_KNOCKOUT), "the swap panel reads the knockout count some other way");

    // Nothing to derive it FROM either: a fixture list reaching this panel would be a second reading.
    assert.doesNotMatch(REGELN, /playedKnockoutSpiele|hasTakenPlace/, "the rules panel derives the freeze itself");
  });

  /* A closed control still has to say why it is closed, and only while the season runs: a finished
     one is answered by the standing banner this panel already carries. */
  it("names the rule behind the closure, and leaves a finished season to its own banner", () => {
    assert.match(markup({ isKnockoutStarted: true }), /Nach dem Beginn der KO-Runde/, "the closure is unexplained");
    assert.doesNotMatch(markup({}), /Nach dem Beginn der KO-Runde/, "an open control is explained as a closed one");
    // Every state, as the freeze above: a gate leaking the sentence into a finished season no
    // knockout has started in passes the other three.
    assert.doesNotMatch(
      markup({ isFinishedSaison: true }),
      /Nach dem Beginn der KO-Runde/,
      "a finished season is explained past its own banner",
    );
    assert.doesNotMatch(markup({ isKnockoutStarted: true, isFinishedSaison: true }), /Nach dem Beginn der KO-Runde/, "explained twice over");
  });
});

/** The two repairs the open window offers, which are what a season past that window may not be sent on. */
const REDRAW = /den Spielplan mit der neuen Zahl neu anlegst/;
const UNDRAW = /nimmst Du den Spielplan zurück/;

/* One per closed state, and they are asserted against each other: both close the same three fields,
   so a case matching only "some closed sentence rendered" would pass on either. */
const RECORDED = /Solange zu mindestens einem Spiel/;
const FROZEN = /Damit sind diese drei Zahlen festgeschrieben/;

describe("the rules panel's note on the frozen shape", () => {
  /* The gate the three cases below cannot see, each holding the note to a state that renders one:
     it explains a freeze, so a season nothing has frozen is told to redraw a Spielplan it has not
     got. */
  it("renders no note at all on a season that holds no draw", () => {
    for (const pattern of [REDRAW, UNDRAW, RECORDED, FROZEN])
      assert.doesNotMatch(markup({}), pattern, "an undrawn season is told how to unfreeze fields nothing has frozen");
  });

  it("offers both repairs while the Spielplan window is open", () => {
    const open = markup({ isDrawnSaison: true, spielplanWindow: "open" });

    assert.match(open, REDRAW, "the qualifiers' own repair is missing where it is on offer");
    assert.match(open, UNDRAW, "the group shape's repair is missing where it is on offer");
    assert.doesNotMatch(open, FROZEN, "an open window is described as a freeze");
  });

  /* Read before any save is attempted, which is what makes it worse than a refusal: an admin acts on
     it without ever provoking the 409 that would have corrected them. */
  it("offers neither repair on a running or finished season, and states the freeze instead", () => {
    const closed = markup({ isDrawnSaison: true, spielplanWindow: "closed" });

    assert.doesNotMatch(closed, UNDRAW, "a season past the window is sent to take the Spielplan back");
    assert.doesNotMatch(closed, REDRAW, "a season past the window is sent to draw the Spielplan again");
    assert.match(closed, FROZEN, "the closure is unexplained");
  });

  /* The state that makes this three sentences and not two: nothing returns a season to `future`,
     while a recorded fact can be removed, so the freeze the case above states would be false here. */
  it("names the condition on a planned season holding a recorded fact, rather than a freeze", () => {
    const recorded = markup({ isDrawnSaison: true, spielplanWindow: "recorded" });

    assert.match(recorded, RECORDED, "the condition that closed both repairs is unnamed");
    assert.doesNotMatch(recorded, FROZEN, "a state the admin can leave is called final");
    assert.doesNotMatch(recorded, UNDRAW, "a closed window is sent to take the Spielplan back");
    assert.doesNotMatch(recorded, REDRAW, "a closed window is sent to draw the Spielplan again");
  });

  /* Read rather than rendered, for this file's own reason: the note is the same markup whichever
     expression decided the state handed in. A flag decided beside that reason could confirm a
     repair the control has closed. */
  it("takes the window from the reason the undraw control is closed by", () => {
    assert.match(EDIT_FORM, /spielplanUndrawBlockedReason\([^)]*\) === null/, "the edit form decides the window some other way");
    assert.doesNotMatch(REGELN, /erfassteSpiele|saisonStatus/, "the rules panel reads the window itself");
  });
});
