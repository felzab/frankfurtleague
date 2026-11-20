import { describe, expect, it } from "vitest";

import { serveBackend } from "@/test-support/backend";
import { doubleNextRequest } from "@/test-support/nextRequest";

import type { FLSaisonFrameResponse, FLSpielJoined, FLSpielplanResponse } from "@/core/generated/client/types";
import type { ListPage } from "@/kit/ListPage";
import type { ComponentProps, ReactElement } from "react";

const team = (id: string, name: string) => ({
  team_id: id.repeat(24),
  name,
  shorthand: name.slice(0, 3).toUpperCase(),
  tore: null,
  austritt_type: null,
});
const GOETHE = team("a", "Goethe");
const HELMHOLTZ = team("b", "Helmholtz");
const LESSING = team("c", "Lessing");

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
  date: null,
  time: null,
  ergebnis: null,
  elfmeterschiessen: null,
  sonderereignis: null,
  ansetzung_confirmed: null,
  for_third_place: false,
  note: null,
  spielort: null,
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
  ].map((spieltag) => ({ ...spieltag, saison_id: "2027", start: null, end: null, version: 1 })),
} as FLSpielplanResponse;

/** The seasons the public may read: 2027 alone. */
const FRAME = {
  saisons: [{ id: "2027", start_date: "2026-09-01", end_date: "2027-06-30" }],
  active_saison_id: "2027",
} satisfies FLSaisonFrameResponse;

/** The backend's reads the page makes: the season pages' frame and 2027's Spielplan; anything else goes unanswered. */
const ANSWERS: Readonly<Record<string, unknown>> = { "/saisons/frame": FRAME, "/saisons/2027/spielplan": SPIELPLAN };

serveBackend(({ method, path }) => (method === "GET" ? ANSWERS[path] : undefined));
// The cached reads declare their tag and lifetime through `next/cache`, which answers only inside Next's cache scope.
doubleNextRequest();

const { default: SpielSearchPage } = await import("./page");

/** The ids of the matches whose words hold `typed`, as the list's search field narrows them, case aside. */
async function found(typed: string) {
  const page = SpielSearchPage({ params: Promise.resolve({ saison: "2027" }), searchParams: Promise.resolve({}) }) as ReactElement<
    ComponentProps<typeof ListPage>
  >;
  const { list } = page.props;
  if (list.kind !== "spiele") throw new Error("the Spielsuche lists matches");
  const { matches } = await list.content;
  return matches.filter(({ words }) => words.toLowerCase().includes(typed.toLowerCase())).map(({ row }) => row.id);
}

const id = (nr: number) => String(nr).repeat(24);

// Words that miss a match's phase, matchday or club hide it from a visitor typing them, with nothing failing.
describe("the Spielsuche's words", () => {
  it.each([
    ["the phase", "Gruppenphase", [id(1), id(2)]],
    ["a club standing on either side", GOETHE.name, [id(1), id(3)]],
    ["the matchday's name as the Spielplan's tab names it", "2. Spieltag", [id(2)]],
  ])("find a match by %s", async (_by, typed, ids) => {
    expect(await found(typed)).toStrictEqual(ids);
  });
});
