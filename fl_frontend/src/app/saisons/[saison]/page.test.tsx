import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";
import { serveBackend } from "@/test-support/backend";
import { doubleNextRequest } from "@/test-support/nextRequest";

import type { FLSaisonFrameResponse, FLSpielJoined, FLSpielplanResponse } from "@/core/generated/client/types";
import type { ListPage } from "@/kit/ListPage";
import type { SpielList } from "@/kit/SpielRow";
import type { ComponentProps, ReactElement } from "react";

/** The seasons the public may read: 2027 alone. */
const FRAME = {
  saisons: [{ id: "2027", start_date: "2026-09-01", end_date: "2027-06-30" }],
  active_saison_id: "2027",
} satisfies FLSaisonFrameResponse;

const team = (id: string, name: string) => ({
  team_id: id.repeat(24),
  name,
  shorthand: name.slice(0, 3).toUpperCase(),
  tore: null,
  austritt_type: null,
});

const idOf = (nr: number) => String(nr).repeat(24);

/** Match `nr` of the first matchday, kicking off on `date`. */
const spiel = (nr: number, date: string): FLSpielJoined => ({
  id: idOf(nr),
  saison_id: "2027",
  saison_phase: "gruppenphase",
  spiel_nr: nr,
  spieltag_id: "g1",
  date,
  time: "10:00",
  ergebnis: null,
  elfmeterschiessen: null,
  sonderereignis: null,
  ansetzung_confirmed: null,
  for_third_place: false,
  note: null,
  spielort: null,
  schiedsrichter: null,
  team1: team("a", "Goethe"),
  team2: team("b", "Lessing"),
  team1_quelle: null,
  team2_quelle: null,
});

/** 2027's one matchday, played over a weekend: its served order, by fixture number, runs against its kick-offs. */
const SPIELPLAN = {
  current_spieltag_id: "g1",
  spieltage: [
    {
      id: "g1",
      saison_id: "2027",
      saison_phase: "gruppenphase",
      position: 1,
      start: null,
      end: null,
      version: 1,
      spiele: [spiel(1, "2027-05-02"), spiel(2, "2027-05-01")],
    },
  ],
} as FLSpielplanResponse;

// The frame and 2027's Spielplan alone are answered: another season's read is a request nothing answers, which fails
// the case by itself.
const backend = serveBackend(({ method, path }) => {
  if (method !== "GET") return undefined;
  if (path === "/saisons/frame") return FRAME;
  if (path === "/saisons/2027/spielplan") return SPIELPLAN;
  return undefined;
});
// The cached reads declare their tag and lifetime through `next/cache`, which answers only inside Next's cache scope.
doubleNextRequest();

const { default: SpielplanPage, generateMetadata } = await import("./page");

// The harm: a matchday played over two days lists a Sunday match above a Saturday one, which only a split matchday
// whose fixture numbers run against its kick-offs shows, and the made-up league holds none.
describe("a matchday's tab", () => {
  it("lists its matches by kick-off, not in the order they are served", async () => {
    const page = SpielplanPage({ params: Promise.resolve({ saison: "2027" }), searchParams: Promise.resolve({}) }) as ReactElement<
      ComponentProps<typeof ListPage>
    >;
    const { list } = page.props;
    if (list.kind !== "spieltage") throw new Error("the Spielplan lists matchdays");
    const panel = (await list.content).tabs?.tabs[0]?.panel as ReactElement<ComponentProps<typeof SpielList>>;

    expect(panel.props.matches.map(({ id }) => id)).toStrictEqual([idOf(2), idOf(1)]);
  });
});

describe("a season the public cannot read", () => {
  // Unknown, malformed or withheld alike: the page's title and canonical would name a Spielplan the page does not show.
  it.each(["2099", "abcd"])("answers %s as not-found in the metadata and the page, reading no Spielplan", async (saison) => {
    const params = Promise.resolve({ saison });

    // Titled as not found rather than thrown: a throw from the metadata leaves the tab the layout's title.
    await expect(generateMetadata({ params, searchParams: Promise.resolve({}) })).resolves.toBe(NOT_FOUND_METADATA);
    // The page has no boundary of its own, so its not-found ends the render before any read.
    await expect(
      renderToReadableStream(
        <SpielplanPage
          params={params}
          searchParams={Promise.resolve({})}
        />,
        { onError: () => undefined },
      ),
    ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(new Set(backend.sent.map(({ method, path }) => `${method} ${path}`))).toStrictEqual(new Set(["GET /saisons/frame"]));
  });
});
