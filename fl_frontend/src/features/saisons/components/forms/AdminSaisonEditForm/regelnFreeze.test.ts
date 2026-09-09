import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { GROUP_COUNT_UNIVERSE, groupCountOptions, SHAPE_COUNT_UNIVERSE } from "@/features/saisons/shapeOffer.ts";
import { pickIfOffered } from "@/shared/components/ui/refusableOption.ts";
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
  // No club entered, so every occupancy rule closes nothing and each case below names its own.
  gruppenOccupancy: {},
  isDrawnSaison: false,
  spielplanWindow: "open",
  banners: [],
};

const markup = (props: Partial<RegelnProps>): string =>
  renderTree(h(DraftStatusProvider, { status: STATUS, children: h(FormRegelnSection, { ...PANEL, ...props }) }));

/**
 * The opening tag of the `<select>` react-aria mirrors a picker into, named by the payload path it
 * writes: the panel's closed controls all wear the same attribute, so an unnamed one would answer
 * for whichever of them moved.
 */
const selectTag = (path: string, props: Partial<RegelnProps>): string =>
  new RegExp(`<select [^>]*name="${path.replaceAll(".", "\\.")}"[^>]*>`).exec(markup(props))?.[0] ?? "";

const tiebreakTag = (props: Partial<RegelnProps>): string => selectTag("rules.tiebreak_order", props);

/** Every count the mirrored `<select>` carries for one path, and which of them the season stands on. */
function offeredCounts(path: string, props: Partial<RegelnProps>): { counts: number[]; selected: number | null } {
  const list = new RegExp(`<select [^>]*name="${path.replaceAll(".", "\\.")}"[^>]*>(.*?)</select>`, "s").exec(markup(props))?.[1] ?? "";
  const rows = [...list.matchAll(/<option value="(\d+)"([^>]*)>/g)];
  const selected = rows.find(([, , attributes]) => attributes?.includes("selected"))?.[1];

  return {
    counts: rows.flatMap(([, value]) => (value === undefined ? [] : [Number(value)])),
    selected: selected === undefined ? null : Number(selected),
  };
}

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

describe("the rules panel's shape offer", () => {
  /* The entry's own instance: `REQ-RULES-001` admits only a power of two, so three groups is refused
     at every qualifier count there is. A stepper cannot state a set that skips, and the mirrored
     `<select>` is where the absence is legible. */
  it("generates no group count the write path refuses", () => {
    const { counts } = offeredCounts("rules.number_of_groups", {});

    assert.deepEqual(counts, [...GROUP_COUNT_UNIVERSE]);
    assert.ok(!counts.includes(3), "the picker offers three groups, which no season can be saved with");
  });

  it("generates the qualifier counts the offer holds and no others", () => {
    assert.deepEqual(offeredCounts("rules.qualifiers_per_group", {}).counts, [...SHAPE_COUNT_UNIVERSE]);
  });

  /* A season can hold a count the offer does not carry. Clear the field and the save sends a number
     nobody chose; the row stands instead, at its place and selected. */
  it("keeps a stored count the offer does not carry, and leaves the season standing on it", () => {
    const stored = { rules: { ...PANEL.rules, number_of_groups: 3 } };
    const { counts, selected } = offeredCounts("rules.number_of_groups", stored);

    assert.deepEqual(
      counts,
      [...GROUP_COUNT_UNIVERSE, 3].sort((first, second) => first - second),
    );
    assert.equal(selected, 3, "the season's own count is not what the picker stands on");
  });

  /* The mirrored `<select>` renders a closed row as a plain option, so the disabled flag is not what
     stops the pick: `pickIfOffered` re-reads the refusal, and the panel drops a key it answers null. */
  it("hands back nothing for a pick on a closed row", () => {
    const options = groupCountOptions({ groups: 2, qualifiers: 2, occupancy: {} });

    assert.equal(pickIfOffered(options, "16"), null, "sixteen groups qualifying two is a bracket of 32, and the picker takes it");
    assert.equal(pickIfOffered(options, "4"), "4");
  });

  /* The occupancy rows obey the stored-count rule above. A season whose clubs stand past its own count
     keeps every row, closed: drop one and the trigger shows a number the list denies. */
  it("keeps every count on offer where the season's own groups close one", () => {
    const occupancy = { A: 4, B: 4, C: 1 };
    const { counts, selected } = offeredCounts("rules.number_of_groups", { gruppenOccupancy: occupancy });

    assert.deepEqual(counts, [...GROUP_COUNT_UNIVERSE]);
    assert.equal(selected, PANEL.rules.number_of_groups, "the season's own count is not what the picker stands on");
    // The refusal reaches no markup at all: the mirrored `<select>` renders a closed row as a plain
    // option, so the closure is read off the offer the panel was handed.
    assert.equal(pickIfOffered(groupCountOptions({ groups: 2, qualifiers: 2, occupancy }), "2"), null);
  });

  /* Read rather than rendered, and a render is what proves it has to be: this panel's markup is
     byte-identical whichever occupancy it is handed, so only the file says the two consumers read
     the prop. */
  it("builds its offer and its team floor from the occupancy it is handed, counted once for both panels", () => {
    // The mirror is where a closure would be legible if it were legible anywhere, and it renders a
    // closed row as a plain option, so the same list arrives whichever occupancy the panel is handed.
    assert.deepEqual(
      offeredCounts("rules.number_of_groups", { gruppenOccupancy: { A: 9, B: 9 } }),
      offeredCounts("rules.number_of_groups", {}),
      "an occupancy now reaches the option list, so a render can assert the closure",
    );

    /* One anchored match per consumer: this panel spells the pair twice, so a whole-file match is
       held up by whichever copy survives while the other one goes. The gap crosses newlines, so a
       Prettier reflow cannot fail it instead. */
    assert.match(REGELN, /groupCountOptions\(\{[^}]*occupancy: gruppenOccupancy/, "the panel builds an offer against something else");
    assert.match(REGELN, /teamsPerGroupFloor\(\{[^}]*occupancy: gruppenOccupancy/, "the team stepper's floor ignores the season's groups");
    assert.doesNotMatch(REGELN, /buildGruppenOccupancy/, "the rules panel counts the groups itself");
    assert.ok(EDIT_FORM.includes("buildGruppenOccupancy(ersatz.rows)"), "the edit form counts the groups some other way");
    // BOTH panels, off that one count: two derivations could close different rows of one season.
    assert.equal(EDIT_FORM.split("gruppenOccupancy={gruppenOccupancy}").length - 1, 2, "one of the two panels is handed no count");
  });

  /* Two selects around one stepper where three steppers stood: react-aria's `Select` has no read-only
     state, so each freeze is spelled twice and a control left off either spelling takes a value the
     save throws away. */
  it("closes each count where its own freeze reaches it", () => {
    assert.doesNotMatch(selectTag("rules.number_of_groups", {}), /\sdisabled=""/, "the groups are closed on a season nothing has frozen");
    assert.doesNotMatch(selectTag("rules.qualifiers_per_group", {}), /\sdisabled=""/, "the qualifiers are closed on a season nothing froze");

    assert.match(selectTag("rules.number_of_groups", { isDrawnSaison: true }), /\sdisabled=""/, "a drawn season still offers its groups");
    assert.match(
      selectTag("rules.qualifiers_per_group", { isDrawnSaison: true }),
      /\sdisabled=""/,
      "a drawn season still offers its qualifiers",
    );

    // The qualifiers alone are in the finished season's freeze: the table is scored from them, and
    // `REQ-RULES-005` names them where it names no group count.
    assert.doesNotMatch(
      selectTag("rules.number_of_groups", { isFinishedSaison: true }),
      /\sdisabled=""/,
      "a finished season freezes its groups",
    );
    assert.match(
      selectTag("rules.qualifiers_per_group", { isFinishedSaison: true }),
      /\sdisabled=""/,
      "a finished season still offers its qualifiers",
    );
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
