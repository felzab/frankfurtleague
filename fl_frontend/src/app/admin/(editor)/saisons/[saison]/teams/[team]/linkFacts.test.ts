import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { linkFactsOf } from "./linkFacts.ts";

import type { FLTeamLinkState } from "@/core/generated/client/types";

const SENT: FLTeamLinkState = {
  invitation: {
    id: "6890a1b2c3d4e5f607260011",
    saison_id: "2026",
    team_id: "6890a1b2c3d4e5f607260001",
    created_at: "2026-09-01",
    revoked_at: null,
    sent_at: "2026-09-02",
    delivery: null,
  },
  running: true,
  paused: false,
  skipped: "already_sent",
};

/* The box's second fact is the one place the team editor says what an entry through the link becomes: a day off by one
   names a nominee an ordinary entry, and nothing else on the page repeats it. */
describe("the link box's Nachnominierung day", () => {
  it("is the day after the window's end, which still takes an ordinary entry", () => {
    // A month's last day, so the day after is the next month's first.
    const [, nominee] = linkFactsOf(SENT, { registrierung_end: "2026-09-30", status: "active" });
    expect(nominee).toStrictEqual({ label: COPY.admin.team.nomineeFrom, value: { record: "01.10.2026" }, figures: true });
  });
});

/* A running season storing no window keeps every link shut, and a box reading „Gesendet am …“ there sends the
   administrator after a club whose pupils can do nothing; a planned season's link is shut by design until its activation. */
describe("the link box's state where the season takes no registration", () => {
  it("says a running season stores no window, and leaves a planned one's mail standing", () => {
    const shut = { ...SENT, running: false };
    const [running] = linkFactsOf(shut, { registrierung_end: null, status: "active" });
    const [planned] = linkFactsOf(shut, { registrierung_end: null, status: "future" });

    expect(running?.value).toBe(COPY.admin.saison.noRegistrierungWindow);
    expect(planned?.value).toStrictEqual(COPY.admin.saison.linkSentOn("2026-09-02"));
  });
});
