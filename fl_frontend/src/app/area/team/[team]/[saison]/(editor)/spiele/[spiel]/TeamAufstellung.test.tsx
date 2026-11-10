// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { LINEUP_WORDS } from "@/features/aufstellungen/players";

import { TeamAufstellung } from "./TeamAufstellung";

import type { LineupPlayer } from "@/kit/Lineup";

const TEAM = "6890a1b2c3d4e5f607250011";
const SPIEL = "6890a1b2c3d4e5f607250021";

const state = vi.hoisted(() => ({ sent: [] as unknown[] }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/area/team/aho/2027/spiele/spiel",
  useParams: () => ({}),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));
vi.mock("./saveAufstellung", () => ({
  saveAufstellung: async (input: unknown) => {
    state.sent.push(input);
    return { ok: true, value: 4 };
  },
}));

const player = (nummer: number): LineupPlayer => ({ id: `p${String(nummer)}`, name: { record: `Spieler ${String(nummer)}` }, nummer });

beforeEach(() => {
  state.sent = [];
});

/** The editor at the team's address over a stored line-up naming pupils 1 to 3, the first two starting. */
function renderEditor() {
  render(
    <TeamAufstellung
      team={TEAM}
      saison="2027"
      title={{ record: "Ahorn vs. Eiche" }}
      lead={COPY.shared.spieltag(2)}
      aufstellung={{
        id: SPIEL,
        version: 3,
        spieler: [
          { spieler_id: "p1", starts: true },
          { spieler_id: "p2", starts: true },
          { spieler_id: "p3", starts: false },
        ],
        // A pupil erased after the match kicked off, who started.
        erased: [{ starts: true }],
      }}
      players={[player(1), player(2), player(3), player(4)]}
      words={LINEUP_WORDS}
    />,
  );
}

const tickOf = (nummer: number) => screen.getByRole("checkbox", { name: `${LINEUP_WORDS.starts} Spieler ${String(nummer)}` });
const bar = () => screen.getByRole("region", { name: COPY.shared.verb.save });

describe("the line-up's editor at the team's address", () => {
  // The harm: a bar counting the named pupils, or the stored starters rather than the ticks, so a team reads eleven
  // starting where it ticked ten; or leaving out an erased pupil's kept start, which the write counts.
  it("counts the starters the ticks and the erased entries hold on its bar, beside the pupils moved", async () => {
    renderEditor();
    const line = () => bar().querySelector("p")?.textContent;
    expect(line()).toBe(COPY.area.team.aufstellung.startelfCount(3, 11));

    await userEvent.click(tickOf(3));
    expect(line()).toBe(`${COPY.area.team.aufstellung.startelfCount(4, 11)}${COPY.template.changesPending(1)}`);
  });

  // The harm: a save sent for another club or match, which a person holding seats on two clubs could write unawares.
  it("saves for the club, the season and the match the page was read for, on the version it read", async () => {
    renderEditor();
    await userEvent.click(tickOf(3));
    await userEvent.click(within(bar()).getByRole("button", { name: COPY.shared.verb.save }));

    await waitFor(() => expect(state.sent).toHaveLength(1));
    expect(state.sent[0]).toMatchObject({ team_id: TEAM, saison_id: "2027", id: SPIEL, version: 3, changes: { starters: ["p1", "p2", "p3"] } });
  });
});
