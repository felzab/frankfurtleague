import { describe, expect, it, vi } from "vitest";

import SpielSearchPage from "./page";

import type { FLSpielJoined, FLSpielplanResponse } from "@/core/generated/client/types";
import type { ListPage } from "@/kit/ListPage";
import type { ComponentProps, ReactElement } from "react";

const club = (id: string, name: string) => ({
  team_id: id.repeat(24),
  name,
  shorthand: name.slice(0, 3).toUpperCase(),
  tore: null,
  austritt_type: null,
});
const GOETHE = club("a", "Goethe");
const HELMHOLTZ = club("b", "Helmholtz");
const LESSING = club("c", "Lessing");

/** One match `nr` of the matchday `spieltag` between two clubs. */
const spiel = (
  nr: number,
  spieltag: string,
  phase: FLSpielJoined["saison_phase"],
  team1: typeof GOETHE,
  team2: typeof GOETHE,
): FLSpielJoined => ({
  id: String(nr).repeat(24).slice(0, 24),
  saison_id: "2027",
  saison_phase: phase,
  spiel_nr: nr,
  spieltag_id: spieltag,
  datum: null,
  uhrzeit: null,
  ergebnis: null,
  elfmeterschiessen: null,
  sonderereignis: null,
  ansetzung_confirmed: null,
  for_third_place: false,
  notiz: null,
  ort: null,
  schiedsrichter: null,
  team1,
  team2,
  team1_quelle: null,
  team2_quelle: null,
});

/** Two group matchdays and the final: Goethe plays on the first and in the final, Helmholtz on all three. */
const SPIELPLAN = {
  current_spieltag_id: null,
  spieltage: [
    { id: "g1", saison_phase: "gruppenphase", position: 1, spiele: [spiel(1, "g1", "gruppenphase", GOETHE, HELMHOLTZ)] },
    { id: "g2", saison_phase: "gruppenphase", position: 2, spiele: [spiel(2, "g2", "gruppenphase", LESSING, HELMHOLTZ)] },
    { id: "f1", saison_phase: "finale", position: 1, spiele: [spiel(3, "f1", "finale", HELMHOLTZ, GOETHE)] },
  ].map((spieltag) => ({ ...spieltag, saison_id: "2027", beginn: null, ende: null, count_spiele: 1, version: 1 })),
} as FLSpielplanResponse;

vi.mock("@/features/saisons/queries", () => ({
  getSaisonFrame: async () => ({ saisons: [{ id: "2027" }], active_saison_id: "2027" }),
  getSpielplan: async () => SPIELPLAN,
}));

/** The numbers of the matches the page lists for the address's query, and the empty state it would show. */
async function found(query: Record<string, string>) {
  const page = SpielSearchPage({ params: Promise.resolve({ saison: "2027" }), searchParams: Promise.resolve(query) }) as ReactElement<
    ComponentProps<typeof ListPage>
  >;
  const { list } = page.props;
  if (list.kind !== "spiele") throw new Error("the Spielsuche lists matches");
  const { matches, empty } = await list.content;
  return { ids: matches.map(({ row }) => row.id), empty: empty.kind };
}

const id = (nr: number) => String(nr).repeat(24);

// A filter that passes the wrong matches shows a visitor fixtures the address did not ask for, or hides the
// ones it did, with nothing failing.
describe("the Spielsuche's filters", () => {
  it("list every match while the address sets none", async () => {
    expect(await found({})).toStrictEqual({ ids: [id(1), id(2), id(3)], empty: "none" });
  });

  it("narrow by phase", async () => {
    expect(await found({ phase: "finale" })).toStrictEqual({ ids: [id(3)], empty: "filter" });
  });

  it("narrow by a club standing on either side", async () => {
    expect((await found({ team: GOETHE.team_id })).ids).toStrictEqual([id(1), id(3)]);
  });

  it("narrow by matchday, its phase and position as the Spielplan's tabs name it", async () => {
    expect((await found({ spieltag: "gruppenphase-2" })).ids).toStrictEqual([id(2)]);
  });

  it("take a value no option holds as none", async () => {
    expect(await found({ phase: "achtelfinale", team: "x".repeat(24), spieltag: "g1" })).toStrictEqual({
      ids: [id(1), id(2), id(3)],
      empty: "none",
    });
  });
});
