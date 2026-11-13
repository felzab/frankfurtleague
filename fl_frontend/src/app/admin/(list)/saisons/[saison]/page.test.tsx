import { doubleApiClient } from "@/test-support/apiClientDouble";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { dayOf } from "@/core/format";

import type { FLOverviewParty, FLSaisonOverviewResponse, FLSpielJoinedAdmin } from "@/core/generated/client/types";
import type { CardActRowProps } from "@/kit/Card";
import type { ReactElement } from "react";

const SPIEL: FLSpielJoinedAdmin = {
  id: "64b000000000000000000001",
  spieltag_id: "64b000000000000000000002",
  team1: { team_id: "64b000000000000000000003", name: "Ahorn", shorthand: "AHO", tore: null, austritt_type: null },
  team2: { team_id: "64b000000000000000000004", name: "Eiche", shorthand: "EIC", tore: null, austritt_type: null },
  team1_quelle: null,
  team2_quelle: null,
  date: "2026-11-14",
  time: "16:00:00",
  spielort: null,
  schiedsrichter: null,
  ergebnis: null,
  elfmeterschiessen: null,
  spiel_nr: 3,
  sonderereignis: null,
  saison_phase: "gruppenphase",
  saison_id: "2027",
  note: null,
  ansetzung_confirmed: null,
  for_third_place: false,
  version: 3,
};

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

let served: FLSaisonOverviewResponse = { cards: [] };

doubleApiClient(() => served);

const { AdminOverview } = await import("./page");

/** The rows of the due card the page draws over `parties` owing their answers on one fixture. */
async function dueRowOver(kind: "spielbestaetigung_due" | "spielbestaetigung_overdue", parties: FLOverviewParty[]) {
  served = { cards: [{ card: "due", rows: [{ kind, spiel: SPIEL, parties }] }] };
  const page = AdminOverview({ saison: Promise.resolve("2027") }) as ReactElement<{
    list: { content: Promise<{ cards: ReadonlyArray<{ rows: ReadonlyArray<CardActRowProps> }> }> };
  }>;
  const { cards } = await page.props.list.content;
  const [row] = cards[0]?.rows ?? [];
  return { chip: row?.chip, line: row?.line };
}

/**
 * A party owing its answer, the day it is due by, a club its deadline and a referee the fixture's day, and the day it
 * lapsed on, `null` while it may still answer; a club whose request was never mailed where `asked` is false.
 */
const party = (kind: "team" | "schiedsrichter", lapsed_on: string | null, asked = true): FLOverviewParty => ({
  spielbestaetigung_id: kind === "team" ? "64b0000000000000000000a1" : "64b0000000000000000000a2",
  party: kind === "team" ? { kind, team_id: "64b000000000000000000003" } : { kind, schiedsrichter_id: "64b000000000000000000005" },
  name: kind === "team" ? "Ahorn" : "Kiefer",
  asked_at: asked ? "2026-11-03" : null,
  due_by: kind === "team" ? "2026-11-10" : "2026-11-14",
  lapsed_on,
});

// The harm: a referee, who answers until the kick-off, read as due on the clubs' day, a club nobody asked read as owing,
// or a lapse dated by a deadline that never bound its party, so the league chases the wrong party on the wrong day. The
// match editor words each party so, and both pages say the same of one row.
describe("the overview's row of a fixture owing answers", () => {
  it.each([
    {
      reads: "due, a club and its referee owing on their own days",
      kind: "spielbestaetigung_due" as const,
      parties: [party("schiedsrichter", null), party("team", null)],
      line: COPY.admin.spiel.answerBy(dayOf("2026-11-10")),
    },
    {
      reads: "due, its referee alone owing",
      kind: "spielbestaetigung_due" as const,
      parties: [party("schiedsrichter", null)],
      line: COPY.admin.spiel.answerBy(dayOf("2026-11-14")),
    },
    {
      reads: "due, a club never asked",
      kind: "spielbestaetigung_due" as const,
      parties: [party("team", null, false), party("schiedsrichter", null)],
      line: COPY.admin.spiel.notAsked,
    },
    {
      reads: "overdue",
      kind: "spielbestaetigung_overdue" as const,
      parties: [party("schiedsrichter", null), party("team", "2026-11-10")],
      line: COPY.admin.schiedsrichter.expiredOn(dayOf("2026-11-10")),
    },
  ])("says when the answer is owed, $reads", async ({ kind, parties, line }) => {
    expect((await dueRowOver(kind, parties)).line).toStrictEqual(line);
  });
});
