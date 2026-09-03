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
    assert.doesNotMatch(markup({ isKnockoutStarted: true, isFinishedSaison: true }), /Nach dem Beginn der KO-Runde/, "explained twice over");
  });
});
