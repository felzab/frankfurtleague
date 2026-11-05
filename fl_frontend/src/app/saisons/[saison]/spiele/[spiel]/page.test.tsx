import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { buildMapsSearchUrl } from "@/core/maps";
import { SERVER_COPY } from "@/core/serverCopy";

import SpielPage, { generateMetadata } from "./page";

import type { FLSpielberichtPublic, FLSpielPageResponse } from "@/core/generated/client/types";
import type { ResolvingMetadata } from "next";
import type { ComponentProps } from "react";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

const SPIEL_ID = "6".repeat(24);

/** The venue's stored `maps_link`: the search string the venue editor derives from its name and address. */
const MAPS_LINK = "Sportpark Nord, Hammarskjöldring 17a, 60439 Frankfurt am Main, Deutschland";

/** A group match played 3:1 at its venue, with the report as a case gives it. */
const page = (bericht: FLSpielberichtPublic | null): FLSpielPageResponse =>
  ({
    spiel: {
      id: SPIEL_ID,
      saison_id: "2027",
      spieltag_id: "s".repeat(24),
      spiel_nr: 1,
      saison_phase: "gruppenphase",
      datum: "2027-03-20",
      uhrzeit: "15:00",
      ergebnis: "3:1",
      elfmeterschiessen: null,
      sonderereignis: null,
      notiz: null,
      ort: { spielort_id: "o".repeat(24), name: "Sportpark Nord", maps_link: MAPS_LINK },
      schiedsrichter: null,
      ansetzung_confirmed: null,
      team1: { team_id: "1".repeat(24), name: "Woehlerschule", shorthand: "WOE", tore: 3, austritt_type: null },
      team2: { team_id: "2".repeat(24), name: "Ernst-Reuter-Schule", shorthand: "ERS", tore: 1, austritt_type: null },
      team1_quelle: null,
      team2_quelle: null,
    },
    spieltag_position: 1,
    standings: { team1: null, team2: null },
    bericht,
  }) as FLSpielPageResponse;

/** What the read serves, and each match id it was asked for, so a case can tell that none was. */
const read = vi.hoisted(() => ({ page: null as FLSpielPageResponse | null, spiele: [] as string[] }));

vi.mock("@/features/saisons/queries", () => ({
  getSaisonFrame: async () => ({ saisons: [{ id: "2027" }], active_saison_id: "2027" }),
  getSpielPage: async (_saison: string, spiel: string) => {
    read.spiele.push(spiel);
    return read.page;
  },
}));

/** The page's whole server render, the document a browser shows before hydrating. */
async function rendered(served: FLSpielPageResponse) {
  read.page = served;
  const stream = await renderToReadableStream(
    <SpielPage
      params={Promise.resolve({ saison: "2027", spiel: SPIEL_ID })}
      searchParams={Promise.resolve({})}
    />,
  );
  await stream.allReady;
  return new Response(stream).text();
}

const { spiel: words } = SERVER_COPY.season;
const NOT_OFFICIAL = COPY.shared.empty.none(words.officialToreAndKarten);
const NOBODY_SCORED = COPY.shared.empty.none(words.toreAndKarten);
const NO_LINEUPS = { team1: null, team2: null };

describe("the match page's server render", () => {
  // Under a 3:1, „no goals yet“ would say nobody scored, where the report naming the scorers awaits adoption.
  it("says the goals and cards are not official yet while the report is not adopted, or none is stored", async () => {
    for (const bericht of [{ aufstellungen: NO_LINEUPS, torschuetzen: null, karten: null }, null]) {
      const html = await rendered(page(bericht));
      expect(html, String(bericht === null)).toContain(NOT_OFFICIAL);
      expect(html, String(bericht === null)).not.toContain(NOBODY_SCORED);
    }
  });

  it("says nobody scored where an adopted report names no goal and no card", async () => {
    const html = await rendered(page({ aufstellungen: NO_LINEUPS, torschuetzen: [], karten: [] }));
    expect(html).toContain(NOBODY_SCORED);
    expect(html).not.toContain(NOT_OFFICIAL);
  });

  // The stored `maps_link` is a search string, not an address a link could open itself.
  it("links the venue to the map's search for its stored search string", async () => {
    const html = await rendered(page(null));
    expect(html).toContain(`href="${buildMapsSearchUrl(MAPS_LINK).replaceAll("&", "&amp;")}"`);
  });

  // The backend answers a malformed id as a route it does not know, which the read takes for a failure: the page
  // would show the error page, and every such address would key a cache entry of its own.
  it("answers a malformed match id as not-found before any read", async () => {
    read.spiele = [];
    const metadata = generateMetadata(
      { params: Promise.resolve({ saison: "2027", spiel: "not-an-id" }), searchParams: Promise.resolve({}) },
      Promise.resolve({}) as unknown as ResolvingMetadata,
    );

    await expect(metadata).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(read.spiele).toStrictEqual([]);
  });
});
