import { doubleApiClient } from "@/test-support/apiClientDouble";
import { person, seat } from "@/test-support/subjectFixtures";
import { describe, expect, it, vi } from "vitest";

import type { FLAufstellungMarks, FLAufstellungResponse, FLSonderereignis } from "@/core/generated/client/types";
import type { ReactElement } from "react";

const TEAM = "6890a1b2c3d4e5f607250011";
const SPIEL = "6890a1b2c3d4e5f607250021";

const state = vi.hoisted(() => ({ marks: null as FLAufstellungMarks | null, sonderereignis: null as FLSonderereignis | null }));

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
    sonderereignis: state.sonderereignis,
  },
  saison_status: "active",
  team_id: TEAM,
  kader: [],
  named: [],
  spieler: [],
  version: null,
  marks: state.marks,
}));

const { default: AufstellungPage } = await import("./page");
const { TeamAufstellung } = await import("./TeamAufstellung");
const { COPY } = await import("@/core/copy");

/** What the page's one boundary resolves to at the team's address for the match, once its read lands. */
async function pageAt(marks: FLAufstellungMarks): Promise<ReactElement<{ closed?: unknown }>> {
  state.marks = marks;
  const shell = AufstellungPage({
    params: Promise.resolve({ team: TEAM, saison: "2027", spiel: SPIEL }),
    searchParams: Promise.resolve({}),
  }) as ReactElement<{
    editor: Promise<ReactElement<{ closed?: unknown }>>;
  }>;
  return shell.props.editor;
}

const MARKS = { stored: false, due_at: "2026-11-13T15:00:00Z" } as const;

describe("a match's line-up at the team's address", () => {
  // The harm: an editor still standing from one hour before kick-off, whose every save the backend then refuses while
  // the page offers it as open.
  it("opens closed from the lock, and open before it", async () => {
    const locked = await pageAt({ ...MARKS, phase: "locked" });
    expect(locked.type).toBe(TeamAufstellung);
    expect(locked.props.closed).toBe(COPY.area.team.aufstellung.lockedLine);
    const open = await pageAt({ ...MARKS, phase: "overdue" });
    expect(open.type).toBe(TeamAufstellung);
    expect(open.props.closed).toBeUndefined();
  });

  // The harm: a match called off still drawn as an overdue line-up, so the club enters one for a match that will not be played.
  it("draws what befell the match after its title, and asks for no line-up then", async () => {
    state.sonderereignis = "ausgefallen";
    const called = (await pageAt({ ...MARKS, phase: "overdue" })) as ReactElement<{ chip?: unknown; lead: string }>;
    state.sonderereignis = null;

    expect(called.props.chip).toStrictEqual({ tone: "danger", label: COPY.spielplan.sonderereignis.ausgefallen });
    expect(called.props.lead.includes(COPY.area.team.aufstellung.overdueSince("2026-11-13"))).toBe(false);
  });
});
