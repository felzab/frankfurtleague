// @vitest-environment jsdom
import { doubleApiClient } from "@/test-support/apiClientDouble";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { LINEUP_WORDS } from "@/features/aufstellungen/players";

import type { FLAufstellungResponse } from "@/core/generated/client/types";
import type { ReactElement } from "react";

const TEAM = "6890a1b2c3d4e5f607250012";
const OTHER_TEAM = "6890a1b2c3d4e5f607250011";
const SPIEL = "6890a1b2c3d4e5f607250021";
const PUPIL = "6890a1b2c3d4e5f607250031";

const state = vi.hoisted(() => ({ sent: [] as unknown[] }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
  usePathname: () => "/admin/saisons/2027/spiele/spiel/aufstellung/team",
  useParams: () => ({}),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));
vi.mock("./saveAufstellung", () => ({
  saveAufstellung: async (input: unknown) => {
    state.sent.push(input);
    return { ok: true, value: 4 };
  },
}));

// The second side's line-up, the first side another club, so a page taking a side's club for the one it read is seen.
doubleApiClient((): FLAufstellungResponse => ({
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
  },
  team_id: TEAM,
  kader: [{ spieler_id: PUPIL, first_name: "Lea", last_name: "Bauer", nummer: "7", position: null, rolle: null, is_nachnominiert: false }],
  named: [],
  spieler: [],
  erased: [],
  version: null,
  marks: { stored: false, phase: "locked", due_at: "2026-11-13T15:00:00Z", locks_at: "2026-11-14T14:00:00Z" },
  saison_status: "active",
}));

const { default: AdminAufstellungPage } = await import("./page");

describe("a club's line-up at the league's address", () => {
  // The harm: a save sent for the other club of the match, or another match, which writes that line-up unseen and
  // answers „Gespeichert“; past the team's lock, too, the league's editor stands open.
  it("saves for the match and the club the page read, on the version it read, the team's lock past", async () => {
    const shell = AdminAufstellungPage({
      params: Promise.resolve({ saison: "2027", spiel: SPIEL, team: TEAM }),
      searchParams: Promise.resolve({}),
    }) as ReactElement<{ editor: Promise<ReactElement> }>;
    render(await shell.props.editor);

    // The squad's one pupil: „Aufstellen“ is that pupil's alone.
    await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${LINEUP_WORDS.pick}`) }));
    const bar = screen.getByRole("region", { name: COPY.shared.verb.save });
    await userEvent.click(within(bar).getByRole("button", { name: COPY.shared.verb.save }));

    await waitFor(() => expect(state.sent).toHaveLength(1));
    expect(state.sent[0]).toMatchObject({ team_id: TEAM, id: SPIEL, version: null, changes: { picked: [PUPIL] } });
  });
});
