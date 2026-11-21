import { describe, expect, it } from "vitest";

import { SERVER_COPY } from "@/core/serverCopy";
import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";
import { serveBackend } from "@/test-support/backend";
import { doubleNextRequest } from "@/test-support/nextRequest";

import type { FLSaisonFrameResponse, FLSpielPageResponse } from "@/core/generated/client/types";
import type { ReadRecord } from "@/kit/ReadPage";
import type { ReactElement } from "react";

/** The seasons the public may read: 2027 alone. */
const FRAME = {
  saisons: [{ id: "2027", start_date: "2026-09-01", end_date: "2027-06-30" }],
  active_saison_id: "2027",
} satisfies FLSaisonFrameResponse;

const SPIEL_ID = "64b000000000000000000001";

/** A group match Weide failed to turn up to, whose adopted report shows Birke a yellow card. */
const FORFEIT: FLSpielPageResponse = {
  spiel: {
    id: SPIEL_ID,
    saison_id: "2027",
    saison_phase: "gruppenphase",
    spiel_nr: 4,
    spieltag_id: "64b000000000000000000002",
    date: "2027-03-13",
    time: "14:00:00",
    ergebnis: "3:0",
    elfmeterschiessen: null,
    sonderereignis: "nichtantreten_team2",
    ansetzung_confirmed: null,
    for_third_place: false,
    note: null,
    spielort: null,
    schiedsrichter: null,
    team1: { team_id: "64b000000000000000000003", name: "Birke", shorthand: "BIR", tore: 3, austritt_type: null },
    team2: { team_id: "64b000000000000000000004", name: "Weide", shorthand: "WEI", tore: 0, austritt_type: null },
    team1_quelle: null,
    team2_quelle: null,
  },
  spieltag_position: 1,
  count_spieltage_in_phase: 3,
  standings: { team1: null, team2: null },
  aufstellungen: { team1: null, team2: null },
  bericht: { scorers: [], cards: [{ colour: "gelb", minute: "12", side: "team1", spieler: { first_name: "Mia", last_name: "Krause" } }] },
};

// The frame alone; a read of any match goes unanswered, which fails the case, unless the case serves it.
const backend = serveBackend(({ method, path }) => (method === "GET" && path === "/saisons/frame" ? FRAME : undefined));
// The cached reads declare their tag and lifetime through `next/cache`, which answers only inside Next's cache scope.
doubleNextRequest();

const { default: SpielPage, generateMetadata } = await import("./page");

describe("the match page's server render", () => {
  // The backend answers a malformed id as a route it does not know, which the read takes for a failure: the page
  // would show the error page, and every such address would key a cache entry of its own.
  it("answers a malformed match id as not-found before any read", async () => {
    const metadata = generateMetadata({ params: Promise.resolve({ saison: "2027", spiel: "not-an-id" }), searchParams: Promise.resolve({}) });

    // Titled as not found rather than thrown: a throw from the metadata leaves the tab the layout's title.
    await expect(metadata).resolves.toBe(NOT_FOUND_METADATA);
    expect(backend.sent.filter(({ path }) => path.includes("/spiele/"))).toStrictEqual([]);
  });

  // The harm: a card the referee reported on a forfeit, adopted and served, missing from the public page.
  it("draws a forfeit's adopted cards", async () => {
    backend.answerWith(({ method, path }) => {
      if (method !== "GET") return undefined;
      if (path === "/saisons/frame") return FRAME;
      return path === `/saisons/2027/spiele/${SPIEL_ID}` ? FORFEIT : undefined;
    });

    const page = SpielPage({
      params: Promise.resolve({ saison: "2027", spiel: SPIEL_ID }),
      searchParams: Promise.resolve({}),
    }) as ReactElement<{
      record: Promise<ReadRecord>;
    }>;
    const { groups } = await page.props.record;

    const timeline = groups.find((group) => group.kind === "timeline");
    expect(timeline?.title).toBe(SERVER_COPY.season.spiel.toreAndCards);
    expect(timeline?.kind === "timeline" ? timeline.items.map(({ point }) => point) : []).toStrictEqual([{ record: "12" }]);
  });
});
