import { doubleApiClient } from "@/test-support/apiClientDouble";
import { person, seat } from "@/test-support/subjectFixtures";
import { describe, expect, it, vi } from "vitest";

import type { FLAufstellungMarks, FLAufstellungResponse } from "@/core/generated/client/types";
import type { ReactElement } from "react";

const TEAM = "6890a1b2c3d4e5f607250011";
const SPIEL = "6890a1b2c3d4e5f607250021";

const state = vi.hoisted(() => ({ marks: null as FLAufstellungMarks | null }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/core/subject", () => ({ getSubjectSession: async () => person({ seats: [seat({ team_id: TEAM, saison_id: "2027" })] }) }));

doubleApiClient((): FLAufstellungResponse => ({
  spiel: {
    spiel_id: SPIEL,
    saison_id: "2027",
    date: "2026-11-14",
    time: "16:00:00",
    team1: null,
    team2: null,
    saison_phase: "gruppenphase",
    spieltag_position: 2,
    count_spieltage_in_phase: 5,
    for_third_place: false,
  },
  team_id: TEAM,
  kader: [],
  named: [],
  spieler: [],
  version: null,
  marks: state.marks,
}));

const { default: AufstellungPage } = await import("./page");
const { LockedLineup } = await import("./lockedView");
const { TeamAufstellung } = await import("./TeamAufstellung");

/** What the page's one boundary resolves to at the team's address for the match, once its read lands. */
async function pageAt(marks: FLAufstellungMarks): Promise<ReactElement> {
  state.marks = marks;
  const shell = AufstellungPage({
    params: Promise.resolve({ team: TEAM, saison: "2027", spiel: SPIEL }),
    searchParams: Promise.resolve({}),
  }) as ReactElement<{
    editor: Promise<ReactElement>;
  }>;
  return shell.props.editor;
}

const MARKS = { stored: false, due_at: "2026-11-13T15:00:00Z", locks_at: "2026-11-14T14:00:00Z" } as const;

describe("a match's line-up at the team's address", () => {
  // The harm: an editor still standing from one hour before kick-off, whose every save the backend then refuses while
  // the page offers it as open.
  it("opens read-only from the lock, and as the editor before it", async () => {
    expect((await pageAt({ ...MARKS, phase: "locked" })).type).toBe(LockedLineup);
    expect((await pageAt({ ...MARKS, phase: "overdue" })).type).toBe(TeamAufstellung);
  });
});
