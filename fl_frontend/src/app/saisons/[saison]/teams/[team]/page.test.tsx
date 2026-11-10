// @vitest-environment jsdom
import { Table } from "@/kit/Table";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";
import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";

import TeamPage, { generateMetadata } from "./page";

import type { FLSpielerPublic, FLTeamPageResponse } from "@/core/generated/client/types";
import type { FoldedCard } from "@/kit/ReadFolds";
import type { ReadRecord } from "@/kit/ReadPage";
import type { TableProps } from "@/kit/Table";
import type { ResolvingMetadata } from "next";
import type { ReactElement } from "react";

const ID = "0".repeat(24);

/** Each club id the read was asked for, so a case can tell that none was; and the page the read answers. */
const read = vi.hoisted(() => ({ teams: [] as string[], page: null as unknown }));

vi.mock("@/features/saisons/queries", () => ({
  getSaisonFrame: async () => ({ saisons: [{ id: "2027" }], active_saison_id: "2027" }),
  getTeamPage: async (_saison: string, team: string) => {
    read.teams.push(team);
    return read.page;
  },
}));

/** A club whose squad is `kader`, with nothing played. */
const pageOf = (kader: FLSpielerPublic[]): FLTeamPageResponse => ({
  team: {
    id: ID,
    name: "Ahorn",
    full_name: "Ahorn-Gymnasium",
    shorthand: "AHO",
    gruppe: "A",
    schulform: null,
    description: "",
    website_url: null,
    austritt: null,
    address: { street: "Ahornweg", house_number: "1", postcode: "60311", city: "Frankfurt", district: "" },
  },
  spiele: [],
  standing: null,
  kader,
});

/** The squad's table as the page folds it, rendered alone. */
async function renderKader(kader: FLSpielerPublic[]) {
  read.page = pageOf(kader);
  const page = TeamPage({ params: Promise.resolve({ saison: "2027", team: ID }), searchParams: Promise.resolve({}) }) as {
    props: { record: Promise<ReadRecord> };
  };
  const { groups } = await page.props.record;
  const folds = groups.find((group) => group.kind === "folds");
  if (folds?.kind !== "folds") throw new Error("no squad on the page");
  const [squad] = (folds.folds as ReactElement<{ cards: readonly FoldedCard[] }>).props.cards;
  const [table] = squad?.tables ?? [];
  render(<Table {...(table as TableProps)} />);
}

const player = (first_name: string | null, rolle: FLSpielerPublic["rolle"]): FLSpielerPublic => ({
  first_name,
  last_name: first_name === null ? null : "B.",
  nummer: "11",
  position: "Abwehr",
  rolle,
});

describe("the club page's server render", () => {
  // The backend answers a malformed id as a route it does not know, which the read takes for a failure: the page
  // would show the error page, and every such address would key a cache entry of its own.
  it("answers a malformed club id as not-found before any read", async () => {
    const metadata = generateMetadata(
      { params: Promise.resolve({ saison: "2027", team: "not-an-id" }), searchParams: Promise.resolve({}) },
      Promise.resolve({}) as unknown as ResolvingMetadata,
    );

    // Titled as not found rather than thrown: a throw from the metadata leaves the tab the layout's title.
    await expect(metadata).resolves.toBe(NOT_FOUND_METADATA);
    expect(read.teams).toStrictEqual([]);
  });
});

describe("the squad's role marks", () => {
  const { rolleMark } = COPY.shared;
  const { rolleOption } = COPY.admin.spieler;

  // The harm: a captain's letters swapped with the Co-Kapitän's, or a mark naming the wrong role to a screen reader.
  it("sets the captain's and the Co-Kapitän's mark after the name, each named by its role", async () => {
    await renderKader([player("Lea", "kapitaen"), player("Finn", "co_kapitaen"), player("Ida", null)]);

    expect(screen.getByText("Lea B.").parentElement?.textContent).toBe(`Lea B.${rolleMark.kapitaen}${rolleOption.kapitaen}`);
    expect(screen.getByText("Finn B.").parentElement?.textContent).toBe(`Finn B.${rolleMark.co_kapitaen}${rolleOption.co_kapitaen}`);
    expect(screen.getByText("Ida B.").parentElement?.textContent).toBe("Ida B.");
  });

  // The harm: a mark beside „anonym“ says who the nameless pupil is. The read serves no role there; the page holds the
  // rule too, since the mark is the page's to place, so a role reaching it beside a withheld name still shows none.
  it("draws no mark beside a withheld name", async () => {
    await renderKader([player(null, "kapitaen")]);

    expect(screen.getByText(SERVER_COPY.season.spiel.anonymous).parentElement?.textContent).toBe(SERVER_COPY.season.spiel.anonymous);
    expect(screen.queryByText(rolleMark.kapitaen)).toBeNull();
  });
});
