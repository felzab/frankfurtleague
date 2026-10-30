import { bestaetigteEinwilligung } from "@/test-support/einwilligung.ts";
import { describe, expect, it } from "vitest";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { collectHeldRollen, countLiveSquadRows, judgeRowReturn, nummerPayload, squadIsFull } from "./utils.ts";

import type { FLSpielerMembership, FLSpielerWithMemberships } from "@/core/generated/client/types.ts";

const TEAM_A = "6890a1b2c3d4e5f607180001";
const TEAM_B = "6890a1b2c3d4e5f607180002";

const MEMBERSHIP: FLSpielerMembership = {
  saison_id: "2026",
  team_id: TEAM_A,
  nummer: null,
  position: null,
  stufe: null,
  ist_nachnominiert: false,
  rolle: null,
  inactive_since: null,
  version: 0,
};

/** Complete at construction, typed as the generated read: a drifted field fails where the fixture is built. */
const SPIELER: FLSpielerWithMemberships = {
  id: "6890a1b2c3d4e5f607180003",
  vorname: "X",
  nachname: null,
  inactive_since: null,
  geburtsdatum: "2009-05-04",
  einwilligung: bestaetigteEinwilligung(),
  email: "x@example.com",
  adresswechsel_id: null,
  adresswechsel_einsehbar_verwehrt: null,
  memberships: [MEMBERSHIP],
  version: 0,
};

function person(
  id: string,
  memberships: Partial<FLSpielerMembership>[],
  // The PERSON's own retirement, which is a different fact from any row's: separate here because the
  // squad count deliberately ignores it.
  personInactiveSince: string | null = null,
): FLSpielerWithMemberships {
  return {
    ...SPIELER,
    id,
    inactive_since: personInactiveSince,
    memberships: memberships.map((membership) => ({ ...MEMBERSHIP, ...membership })),
  };
}

describe("collectHeldRollen", () => {
  it("names who holds each role, by team", () => {
    const held = collectHeldRollen({
      spieler: [
        person("a", [{ rolle: "kapitaen" }]),
        person("b", [{ rolle: "co_kapitaen" }]),
        person("c", [{ team_id: TEAM_B, rolle: "kapitaen" }]),
      ],
      saisonId: "2026",
      exceptSpielerId: "z",
    });

    expect(held[TEAM_A]).toStrictEqual({ kapitaen: "X", co_kapitaen: "X" });
    expect(held[TEAM_B]).toStrictEqual({ kapitaen: "X" });
  });

  it("leaves a retired row out, because a player who left is not leading the squad", () => {
    const held = collectHeldRollen({
      spieler: [person("a", [{ rolle: "kapitaen", inactive_since: "2026-03-01" }])],
      saisonId: "2026",
      exceptSpielerId: "z",
    });

    expect(held[TEAM_A]).toBe(undefined);
  });

  it("leaves another season out", () => {
    const held = collectHeldRollen({
      spieler: [person("a", [{ saison_id: "2025", rolle: "kapitaen" }])],
      saisonId: "2026",
      exceptSpielerId: "z",
    });

    expect(held[TEAM_A]).toBe(undefined);
  });

  it("does not hold the edited player's own role against them", () => {
    const held = collectHeldRollen({
      spieler: [person("a", [{ rolle: "kapitaen" }])],
      saisonId: "2026",
      exceptSpielerId: "a",
    });

    expect(held[TEAM_A]).toBe(undefined);
  });

  it("reports no holder where every row is roleless", () => {
    const held = collectHeldRollen({ spieler: [person("a", [{}])], saisonId: "2026", exceptSpielerId: "z" });

    expect(held[TEAM_A]).toBe(undefined);
  });
});

describe("countLiveSquadRows", () => {
  it("counts each club's live rows for the season", () => {
    const counts = countLiveSquadRows({
      spieler: [person("a", [{}]), person("b", [{}]), person("c", [{ team_id: TEAM_B }])],
      saisonId: "2026",
      exceptSpielerId: null,
    });

    expect(counts[TEAM_A]).toBe(2);
    expect(counts[TEAM_B]).toBe(1);
  });

  /* The same rows the write path counts: counting a retired one would report a squad full that the
     endpoint would still admit a player to. */
  it("leaves a retired row out, because a player who left gave their place back", () => {
    const counts = countLiveSquadRows({
      spieler: [person("a", [{}]), person("b", [{ inactive_since: "2026-03-01" }])],
      saisonId: "2026",
      exceptSpielerId: null,
    });

    expect(counts[TEAM_A]).toBe(1);
  });

  it("leaves another season out", () => {
    const counts = countLiveSquadRows({
      spieler: [person("a", [{ saison_id: "2025" }])],
      saisonId: "2026",
      exceptSpielerId: null,
    });

    expect(counts[TEAM_A]).toBe(undefined);
  });

  /* Both sides of the exclusion on one input: a player already in the squad must not be told it is
     full by their own place, and a caller naming no writer counts every live row. */
  it("leaves the writing player's own row out, and counts it where no writer is named", () => {
    const spieler = [person("a", [{}]), person("b", [{}])];

    expect(countLiveSquadRows({ spieler, saisonId: "2026", exceptSpielerId: "a" })[TEAM_A]).toBe(1);
    expect(countLiveSquadRows({ spieler, saisonId: "2026", exceptSpielerId: null })[TEAM_A]).toBe(2);
  });

  /* `build_live_squad_filter` reads the junction alone. Skipping a retired person here would report
     room the endpoint refuses, which is the direction that walks an admin onto a failing press. */
  it("counts the live row of a player the league retired", () => {
    const counts = countLiveSquadRows({
      spieler: [person("a", [{}], "2026-04-01")],
      saisonId: "2026",
      exceptSpielerId: null,
    });

    expect(counts[TEAM_A]).toBe(1);
  });

  /* Absent rather than zero, as `collectHeldRollen` reports no holder: one shape for "this club has
     nothing to report", so a caller reads both maps the same way. */
  it("reports no count for a club whose rows are all retired", () => {
    const counts = countLiveSquadRows({
      spieler: [person("a", [{ inactive_since: "2026-03-01" }])],
      saisonId: "2026",
      exceptSpielerId: null,
    });

    expect(counts[TEAM_A]).toBe(undefined);
  });
});

describe("squadIsFull", () => {
  /* `>` here would leave one place open in a squad the endpoint has already closed, and every picker
     and row gate on three pages would then offer a write that comes back 409. */
  it("closes a squad standing AT the cap and no earlier", () => {
    expect(squadIsFull(9, 10)).toBe(false);
    expect(squadIsFull(10, 10)).toBe(true);
    expect(squadIsFull(11, 10)).toBe(true);
  });

  /* `countLiveSquadRows` reports a club with no live row as absent rather than as zero, so the
     unbounded reading of that gap is what would refuse an empty squad. */
  it("reads an uncounted club as empty", () => {
    expect(squadIsFull(undefined, 1)).toBe(false);
  });

  /* A page that resolved no season reads no cap. Refusing there would take a write the endpoint
     accepts, on a figure nothing on that page could show the admin. */
  it("refuses nothing where the cap is unknown", () => {
    expect(squadIsFull(99, null)).toBe(false);
  });
});

describe("judgeRowReturn", () => {
  const stored = { teamId: TEAM_A, name: "SG Alpha", shorthand: "SGA" };
  const other = { teamId: TEAM_B, name: "TSV Beta", shorthand: "TSB" };

  /* `kader_team_not_in_saison` is asked first there, so a replaced club is reported before any squad count, and a
     reader is never sent to free a place in a season the club has left. */
  it("refuses a row whose club the season no longer holds, whatever any squad's room", () => {
    expect(judgeRowReturn(TEAM_A, [{ ...other, isSquadFull: true }])).toBe("clubLeft");
    expect(judgeRowReturn(TEAM_A, [])).toBe("clubLeft");
  });

  // The row's own club and no other: the count is per squad.
  it("refuses a row whose own club's squad is full, and no row for another club's", () => {
    expect(judgeRowReturn(TEAM_A, [{ ...stored, isSquadFull: true }, other])).toBe("squadFull");
    expect(judgeRowReturn(TEAM_A, [stored, { ...other, isSquadFull: true }])).toBe("open");
  });

  // An unknown cap refuses nothing, as `SpielerTeamOption.isSquadFull` declares.
  it("opens a row whose club's room is unknown", () => {
    expect(judgeRowReturn(TEAM_A, [stored])).toBe("open");
  });
});

describe("nummerPayload", () => {
  // Both squad forms send through it, so one number is never refused on one form and taken on the other.
  it("sends a number without the space around it, and an emptied box as no number", () => {
    expect(nummerPayload(" 7 ")).toBe("7");
    expect(nummerPayload("  ")).toBe(null);
    expect(nummerPayload(null)).toBe(null);
  });
});
