// @vitest-environment jsdom
import { Table } from "@/kit/Table";
import { serveBackend } from "@/test-support/backend.ts";
import { doubleNextRequest } from "@/test-support/nextRequest.ts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";
import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";

import type { FLAufstellungEntryPublic, FLSaisonFrameResponse, FLSpielPageResponse } from "@/core/generated/client/types";
import type { FoldedCard } from "@/kit/ReadFolds";
import type { ReadRecord } from "@/kit/ReadPage";
import type { ResolvingMetadata } from "next";
import type { ReactElement } from "react";

const ID = "2".repeat(24);

/** The seasons the public may read: 2027 alone. */
const FRAME = {
  saisons: [{ id: "2027", start_date: "2026-09-01", end_date: "2027-06-30" }],
  active_saison_id: "2027",
} satisfies FLSaisonFrameResponse;

/** The match page the backend serves at `ID`, which a case sets. */
let served: FLSpielPageResponse | undefined;

// The frame and the one match's page; a read of any other match goes unanswered, which fails the case.
const backend = serveBackend(({ method, path }) => {
  if (method !== "GET") return undefined;
  if (path === "/saisons/frame") return FRAME;
  return path === `/saisons/2027/spiele/${ID}` ? served : undefined;
});
// The cached reads declare their tag and lifetime through `next/cache`, which answers only inside Next's cache scope.
doubleNextRequest();

const { default: SpielPage, generateMetadata } = await import("./page");

/** An unplayed group match between Ahorn and Kastanie, Ahorn's line-up `spieler` and Kastanie's none. */
const pageOf = (spieler: FLAufstellungEntryPublic[]): FLSpielPageResponse => ({
  spiel: {
    id: ID,
    saison_id: "2027",
    saison_phase: "gruppenphase",
    spiel_nr: 1,
    spieltag_id: "3".repeat(24),
    date: "2027-03-13",
    time: "14:00",
    ergebnis: null,
    elfmeterschiessen: null,
    sonderereignis: null,
    ansetzung_confirmed: null,
    for_third_place: false,
    note: null,
    spielort: null,
    schiedsrichter: null,
    team1: { team_id: "0".repeat(24), name: "Ahorn", shorthand: "AHO", tore: null, austritt_type: null },
    team2: { team_id: "1".repeat(24), name: "Kastanie", shorthand: "KAS", tore: null, austritt_type: null },
    team1_quelle: null,
    team2_quelle: null,
  },
  spieltag_position: 1,
  count_spieltage_in_phase: 1,
  standings: { team1: null, team2: null },
  aufstellungen: { team1: { spieler }, team2: null },
  bericht: null,
});

/** Ahorn's starters as the page folds them, rendered alone. */
async function renderStartelf(spieler: FLAufstellungEntryPublic[]) {
  served = pageOf(spieler);
  const page = SpielPage({ params: Promise.resolve({ saison: "2027", spiel: ID }), searchParams: Promise.resolve({}) }) as {
    props: { record: Promise<ReadRecord> };
  };
  const { groups } = await page.props.record;
  const folds = groups.find((group) => group.kind === "folds");
  if (folds?.kind !== "folds") throw new Error("no line-ups on the page");
  const [ahorn] = (folds.folds as ReactElement<{ cards: readonly FoldedCard[] }>).props.cards;
  const [startelf] = ahorn?.tables ?? [];
  if (startelf === undefined || !("head" in startelf)) throw new Error("no starters in Ahorn's line-up");
  render(<Table {...startelf.table} />);
}

const entry = (first_name: string | null, rolle: FLAufstellungEntryPublic["rolle"]): FLAufstellungEntryPublic => ({
  first_name,
  last_name: first_name === null ? null : "B.",
  nummer: "11",
  position: "Abwehr",
  rolle,
  starts: true,
});

describe("the match page's server render", () => {
  // The backend answers a malformed id as a route it does not know, which the read takes for a failure: the page
  // would show the error page, and every such address would key a cache entry of its own.
  it("answers a malformed match id as not-found before any read", async () => {
    const metadata = generateMetadata(
      { params: Promise.resolve({ saison: "2027", spiel: "not-an-id" }), searchParams: Promise.resolve({}) },
      Promise.resolve({}) as unknown as ResolvingMetadata,
    );

    // Titled as not found rather than thrown: a throw from the metadata leaves the tab the layout's title.
    await expect(metadata).resolves.toBe(NOT_FOUND_METADATA);
    expect(backend.sent.filter(({ path }) => path.includes("/spiele/"))).toStrictEqual([]);
  });
});

describe("a line-up's role marks", () => {
  const { rolleMark } = COPY.shared;
  const { rolleOption } = COPY.admin.spieler;

  // The harm: a captain's letters swapped with the Co-Kapitän's, or a mark naming the wrong role to a screen reader.
  it("sets the captain's and the Co-Kapitän's mark after the name, each named by its role", async () => {
    await renderStartelf([entry("Lea", "kapitaen"), entry("Finn", "co_kapitaen"), entry("Ida", null)]);

    expect(screen.getByText("Lea B.").parentElement?.textContent).toBe(`Lea B.${rolleMark.kapitaen}${rolleOption.kapitaen}`);
    expect(screen.getByText("Finn B.").parentElement?.textContent).toBe(`Finn B.${rolleMark.co_kapitaen}${rolleOption.co_kapitaen}`);
    expect(screen.getByText("Ida B.").parentElement?.textContent).toBe("Ida B.");
  });

  // The harm: a mark beside „anonym“ says who the nameless pupil is. The read serves no role there; the page holds the
  // rule too, since the mark is the page's to place, so a role reaching it beside a withheld name still shows none.
  it("draws no mark beside a withheld name", async () => {
    await renderStartelf([entry(null, "kapitaen")]);

    expect(screen.getByText(COPY.shared.anonymous).parentElement?.textContent).toBe(COPY.shared.anonymous);
    expect(screen.queryByText(rolleMark.kapitaen)).toBeNull();
  });
});
