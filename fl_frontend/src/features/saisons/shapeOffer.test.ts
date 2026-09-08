import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FLPostSaisonPayloadSchema } from "@/features/saisons/schemas";

import {
  GROUP_COUNT_UNIVERSE,
  groupCountOptions,
  MAX_GROUPS,
  MAX_TEAMS_PER_GROUP,
  MIN_TEAMS_PER_GROUP,
  qualifierCountOptions,
  SHAPE_COUNT_UNIVERSE,
  SHAPE_REFUSAL_NOTE,
  teamsPerGroupFloor,
} from "./shapeOffer.ts";

import type { FLSpielplanShape } from "@/features/saisons/schemas";

const RULES = {
  win_points: 3,
  draw_points: 1,
  qualifiers_per_group: 2,
  number_of_groups: 2,
  teams_per_group: 4,
  tiebreak_order: "tordifferenz",
  max_kadergroesse: 50,
  forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
  erlaubte_stufen: ["E1"],
};

/**
 * Whether a whole create carrying this shape parses. The PAYLOAD rather than a field schema:
 * `REQ-RULES-001` and `REQ-RULES-007` read two of the three numbers each, so they are refinements on
 * the season, and an offer is held to them rather than to a second copy of itself.
 */
const saves = (shape: FLSpielplanShape): boolean =>
  FLPostSaisonPayloadSchema.safeParse({
    id: "2026",
    start_date: "2025-09-01",
    end_date: "2026-06-30",
    bewerbung: { offen: true, von: "2025-05-01", bis: "2025-06-30" },
    rules: { ...RULES, ...shape },
  }).success;

/** Every count an admin could reach, offered or not, so a case can ask what the offer left out. */
const upTo = (ceiling: number): number[] => Array.from({ length: ceiling }, (_, index) => index + 1);

const counts = (options: readonly { id: string }[]): number[] => options.map((row) => Number(row.id));
const refusalOf = (options: readonly { id: string; refusal: string | null }[], count: number): string | null | undefined =>
  options.find((row) => row.id === String(count))?.refusal;

describe("the group count offer", () => {
  /* The whole claim, one row at a time: an open row the create refuses is the offer
     `.claude/rules/cross-surface.md`'s **saisons** clause bars, and a closed row it would have taken
     is an offer narrowed past the rules. */
  it("opens exactly the counts a create saves", () => {
    for (const qualifiers of SHAPE_COUNT_UNIVERSE) {
      for (const row of groupCountOptions({ groups: 1, qualifiers })) {
        const groups = Number(row.id);
        // Groups of the largest size the schema takes, so `REQ-RULES-007` cannot be what closes a row
        // here: the team count bounds the qualifiers and never the groups.
        const shape = { number_of_groups: groups, qualifiers_per_group: qualifiers, teams_per_group: MAX_TEAMS_PER_GROUP };

        assert.equal(row.refusal === null, saves(shape), `${String(groups)} groups qualifying ${String(qualifiers)}`);
      }
    }
  });

  /* The other direction, which the case above cannot see: a count the offer never generates is one
     no admin can reach, so dropping a legal one from the universe closes it as surely as a refusal. */
  it("generates a row for every count a create saves", () => {
    for (const qualifiers of SHAPE_COUNT_UNIVERSE) {
      const offered = new Set(counts(groupCountOptions({ groups: 1, qualifiers })));

      for (const groups of upTo(MAX_GROUPS + 1)) {
        const shape = { number_of_groups: groups, qualifiers_per_group: qualifiers, teams_per_group: MAX_TEAMS_PER_GROUP };
        if (!saves(shape)) continue;

        assert.ok(offered.has(groups), `${String(groups)} groups qualifying ${String(qualifiers)} saves and is not on offer`);
      }
    }
  });

  /* A season stored before these rules holds a count no shape satisfies. Drop it and the trigger
     shows a number the list does not carry; offer it and the picker promises a season that cannot
     be saved. It is a row, closed, at its place in numeric order. */
  it("keeps a stored count the universe does not carry", () => {
    const rows = groupCountOptions({ groups: 3, qualifiers: 2 });

    assert.deepEqual(
      counts(rows),
      [...GROUP_COUNT_UNIVERSE, 3].sort((first, second) => first - second),
    );
    assert.equal(refusalOf(rows, 3), SHAPE_REFUSAL_NOTE.noBracket);
  });
});

describe("the qualifier count offer", () => {
  /* The group count's own case, from the other side, and against the team count as well: this is the
     one control all three of `REQ-RULES-001` and `REQ-RULES-007`'s combinations reach. */
  it("opens exactly the counts a create saves", () => {
    for (const groups of GROUP_COUNT_UNIVERSE) {
      for (const teams of [MIN_TEAMS_PER_GROUP, 4, MAX_TEAMS_PER_GROUP]) {
        for (const row of qualifierCountOptions({ groups, qualifiers: 1, teams })) {
          const shape = { number_of_groups: groups, qualifiers_per_group: Number(row.id), teams_per_group: teams };

          assert.equal(row.refusal === null, saves(shape), `${String(groups)} groups of ${String(teams)} qualifying ${row.id}`);
        }
      }
    }
  });

  /* An emptied team stepper has answered nothing, so it may not close a row: a banner about a rule
     nobody has typed yet reads as a fault the admin caused. */
  it("lets an unanswered team count close nothing", () => {
    assert.equal(refusalOf(qualifierCountOptions({ groups: 2, qualifiers: 1, teams: null }), 8), null);
    assert.equal(refusalOf(qualifierCountOptions({ groups: 2, qualifiers: 1, teams: 2 }), 8), SHAPE_REFUSAL_NOTE.overQualifies);
  });

  /* The stored-count case on this side. Its note is whichever rule shuts it, which here is the group
     count standing beside it rather than anything about the number itself. */
  it("keeps a stored count the universe does not carry", () => {
    const rows = qualifierCountOptions({ groups: 2, qualifiers: 3, teams: MAX_TEAMS_PER_GROUP });

    assert.deepEqual(
      counts(rows),
      [...SHAPE_COUNT_UNIVERSE, 3].sort((first, second) => first - second),
    );
    assert.equal(refusalOf(rows, 3), SHAPE_REFUSAL_NOTE.noBracket);
  });
});

describe("what a closed row says", () => {
  /* Two notes for `REQ-RULES-001` and not one: a bracket too large comes down and one too small goes
     up, and the note is the whole of what tells a reader which way to move. */
  it("parts a bracket that is too small from one that is too large", () => {
    assert.equal(refusalOf(groupCountOptions({ groups: 1, qualifiers: 1 }), 1), SHAPE_REFUSAL_NOTE.noBracket);
    assert.equal(
      refusalOf(qualifierCountOptions({ groups: MAX_GROUPS, qualifiers: 1, teams: MAX_TEAMS_PER_GROUP }), 2),
      SHAPE_REFUSAL_NOTE.bracketTooLarge,
    );
  });

  /* `REQ-RULES-007` ahead of `REQ-RULES-001`, as `find_rules_refusal` judges them: name the bracket
     here and the reader is sent to a number that is not what shut the row. */
  it("names the group's own size where both rules would close a row", () => {
    assert.equal(
      refusalOf(qualifierCountOptions({ groups: MAX_GROUPS, qualifiers: 1, teams: MIN_TEAMS_PER_GROUP }), 4),
      SHAPE_REFUSAL_NOTE.overQualifies,
    );
  });
});

describe("the team count", () => {
  /* Drift either bound and the stepper offers a size the create refuses, or hides one it takes. */
  it("is bounded where the schema bounds it", () => {
    const held = (teams: number) => ({ number_of_groups: 2, qualifiers_per_group: 2, teams_per_group: teams });

    assert.equal(saves(held(MIN_TEAMS_PER_GROUP)), true);
    assert.equal(saves(held(MIN_TEAMS_PER_GROUP - 1)), false);
    assert.equal(saves(held(MAX_TEAMS_PER_GROUP)), true);
    assert.equal(saves(held(MAX_TEAMS_PER_GROUP + 1)), false);
  });

  it("takes its floor from the qualifiers, so a group cannot be sent below what it qualifies", () => {
    assert.equal(teamsPerGroupFloor({ qualifiers: 8, held: MAX_TEAMS_PER_GROUP }), 8);
    assert.equal(teamsPerGroupFloor({ qualifiers: 1, held: MAX_TEAMS_PER_GROUP }), MIN_TEAMS_PER_GROUP);
    assert.equal(teamsPerGroupFloor({ qualifiers: 8, held: null }), 8);
  });

  /* react-stately snaps a controlled value into the range before rendering and calls no handler, so a
     floor above the held value shows a number the payload does not carry. A season stored
     over-qualifying keeps saving its other fields (`docs/backend/spec.md :: I44`). */
  it("never puts its floor above the value the draft holds", () => {
    assert.equal(teamsPerGroupFloor({ qualifiers: 8, held: 4 }), 4);
  });
});

describe("the group cap", () => {
  /* The cap is the closed name set's size on the backend and here, and the create payload's own
     ceiling is a third spelling of it. Let them part and the picker offers a season the create
     refuses outright, which is the defect this module exists to close. */
  it("is a group count a create saves", () => {
    assert.equal(saves({ number_of_groups: MAX_GROUPS, qualifiers_per_group: 1, teams_per_group: MAX_TEAMS_PER_GROUP }), true);
  });
});
