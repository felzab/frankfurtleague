// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { COPY } from "@/core/copy/shared";
import { LINEUP_WORDS } from "@/features/aufstellungen/players";
import { serveBackend } from "@/test-support/backend";
import { renderUnderNext } from "@/test-support/nextContexts";
import { signedInRequest } from "@/test-support/session";

import type { FLAufstellungResponse } from "@/core/generated/client/types";
import type { NextContexts } from "@/test-support/nextContexts";

const TEAM = "6890a1b2c3d4e5f607250012";
const OTHER_TEAM = "6890a1b2c3d4e5f607250011";
const SPIEL = "6890a1b2c3d4e5f607250021";
const PUPIL = "6890a1b2c3d4e5f607250031";

const state = vi.hoisted(() => ({ sent: [] as unknown[] }));

const AT_ADDRESS: NextContexts = { pathname: "/admin/saisons/2027/spiele/spiel/aufstellung/team", params: {} };
// The save is a server function, which the editor calls over the network as a client: what it was handed is the outcome.
vi.mock("./saveAufstellung", () => ({
  saveAufstellung: async (input: unknown) => {
    state.sent.push(input);
    return { ok: true, value: 4 };
  },
}));

// The second side's line-up, the first side another club, so a page taking a side's club for the one it read is seen;
// answered at the match and the club the address names alone, through the real guard, query and generated call.
const LINEUP: FLAufstellungResponse = {
  spiel: {
    spiel_id: SPIEL,
    saison_id: "2027",
    date: "2026-11-14",
    time: "16:00:00",
    team1: { team_id: OTHER_TEAM, name: "Ahorn", shorthand: "AHO" },
    team2: { team_id: TEAM, name: "Eiche", shorthand: "EIC" },
    saison_phase: "gruppenphase",
    spieltag_position: 2,
    count_spieltage_in_phase: 5,
    for_third_place: false,
    sonderereignis: null,
  },
  team_id: TEAM,
  kader: [{ spieler_id: PUPIL, first_name: "Lea", last_name: "Bauer", nummer: "7", position: null, rolle: null, is_nachnominiert: false }],
  named: [],
  spieler: [],
  version: null,
  marks: { stored: false, phase: "locked", due_at: "2026-11-13T15:00:00Z" },
  saison_status: "active",
};
/** The line-up the read answers, the case's own where it sets one. */
let answered = LINEUP;
serveBackend(({ method, path }) => (method === "GET" && path === `/aufstellungen/spiele/${SPIEL}/teams/${TEAM}/admin` ? answered : undefined));
// An administrator's session, made by passkey, which the read's guard admits.
signedInRequest();

const { default: AdminAufstellungPage } = await import("./page");

describe("a club's line-up at the league's address", () => {
  // The harm: a save sent for the other club of the match, or another match, which writes that line-up unseen and
  // answers „Gespeichert“; past the team's lock, too, the league's editor stands open.
  it("saves for the match and the club the page read, on the version it read, the team's lock past", async () => {
    renderUnderNext(
      await AdminAufstellungPage({
        params: Promise.resolve({ saison: "2027", spiel: SPIEL, team: TEAM }),
        searchParams: Promise.resolve({}),
      }),
      AT_ADDRESS,
    );

    // The squad's one pupil: „Aufstellen“ is that pupil's alone.
    await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${LINEUP_WORDS.pick}`) }));
    const bar = screen.getByRole("region", { name: COPY.shared.verb.save });
    await userEvent.click(within(bar).getByRole("button", { name: COPY.shared.verb.save }));

    await waitFor(() => expect(state.sent).toHaveLength(1));
    expect(state.sent[0]).toMatchObject({ team_id: TEAM, id: SPIEL, version: null, changes: { picked: [PUPIL] } });
  });

  // The harm: „Noch kein Kader.“ on a finished season promises a squad that cannot come, and so rare a state never
  // meets a look at the page.
  it("says no squad and no line-up were recorded in a finished season, where none can come", async () => {
    answered = { ...LINEUP, kader: [], saison_status: "past" };
    onTestFinished(() => {
      answered = LINEUP;
    });
    renderUnderNext(
      await AdminAufstellungPage({
        params: Promise.resolve({ saison: "2027", spiel: SPIEL, team: TEAM }),
        searchParams: Promise.resolve({}),
      }),
      AT_ADDRESS,
    );

    expect(screen.getByText(COPY.shared.empty.unrecordedOne(COPY.shared.kader))).toBeTruthy();
    expect(screen.getByText(COPY.shared.empty.unrecorded(LINEUP_WORDS.picked))).toBeTruthy();
  });
});
