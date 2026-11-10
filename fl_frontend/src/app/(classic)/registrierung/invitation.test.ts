import { describe, expect, it, vi } from "vitest";

import { SERVER_COPY } from "@/core/serverCopy";

import { endOf } from "./invitation";

import type { FLInvitationViewResponse } from "@/core/generated/client/types";

vi.mock("server-only", () => ({}));

const WORDS = SERVER_COPY.registrierung.end;

const OPEN: FLInvitationViewResponse = {
  team: "Kastanie",
  schule: "Kastanie-Gymnasium",
  saison_id: "2027",
  saison_status: "active",
  running: true,
  allowed_stufen: ["Q1", "Q2"],
  team_entered: true,
  kader_free: true,
  nachnominierung: false,
};

// A pupil told the wrong end goes away for the wrong reason: told the squad is full when the window shut, they wait for a
// place that never comes, and no other page says which it was.
describe("which end stands in the form's place", () => {
  it("shows the form while the link opens it", () => {
    expect(endOf(OPEN)).toBeNull();
  });

  it("says the registration is shut ahead of every other verdict, and the season over once it is", () => {
    const shut = { ...OPEN, running: false, team_entered: false, kader_free: false };

    expect(endOf(shut)?.title).toBe(WORDS.closed);
    expect(endOf({ ...shut, saison_status: "past" })?.title).toBe(SERVER_COPY.bewerbung.end.over);
  });

  it("says the team does not play ahead of a full squad", () => {
    expect(endOf({ ...OPEN, team_entered: false, kader_free: false })?.title).toBe(WORDS.teamNotEntered);
  });

  it("says the squad is full", () => {
    expect(endOf({ ...OPEN, kader_free: false })?.title).toBe(WORDS.kaderFull);
  });
});
