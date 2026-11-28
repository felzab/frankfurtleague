// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";
import { serveBackend } from "@/test-support/backend";
import { underNext } from "@/test-support/nextContexts";
import { doubleNextRequest } from "@/test-support/nextRequest";
import { drawnOnServer } from "@/test-support/server";

import type { FLSaisonFrameResponse, FLTabelleResponse, FLTabelleRow } from "@/core/generated/client/types";
import type { TableStandingRow } from "@/kit/TableStanding";

const STATISTIK = {
  count_cancelled_spiele: 0,
  count_played_spiele: 3,
  siege: 1,
  unentschieden: 1,
  niederlagen: 1,
  tore_scored: 4,
  tore_conceded: 4,
  punkte: 4,
};

/** A club of group A at the place a case gives it. */
const row = (id: string, platz: number | null): FLTabelleRow => ({
  id: id.repeat(24),
  name: `Schule ${id}`,
  shorthand: `${id}${id}${id}`.toUpperCase(),
  platz,
  austritt_type: null,
  statistik: STATISTIK,
});

/** The seasons the public may read: 2027 alone. */
const FRAME = {
  saisons: [{ id: "2027", start_date: "2026-09-01", end_date: "2027-06-30" }],
  active_saison_id: "2027",
} satisfies FLSaisonFrameResponse;

/** The Tabelle each case serves: group A's rows, two qualifying. */
let tabelle: FLTabelleResponse | undefined;

// The frame and 2027's Tabelle; any other read goes unanswered, which fails the case.
serveBackend(({ method, path }) => {
  if (method !== "GET") return undefined;
  if (path === "/saisons/frame") return FRAME;
  return path === "/saisons/2027/tabelle" ? tabelle : undefined;
});
// The cached reads declare their tag and lifetime through `next/cache`, which answers only inside Next's cache scope.
doubleNextRequest();

const { default: TabellePage } = await import("./page");

/** The page as it lands for `gruppen`, two qualifying in each group. */
async function landed(gruppen: FLTabelleResponse["gruppen"]) {
  tabelle = { gruppen, qualifiers_per_gruppe: 2 };
  return drawnOnServer(
    underNext(
      <TabellePage
        params={Promise.resolve({ saison: "2027" })}
        searchParams={Promise.resolve({})}
      />,
      { pathname: "/saisons/2027/tabelle" },
    ),
  );
}

/** The rank cell of a club's row, found by its fragment, the club's id. */
const rankOf = (page: HTMLElement, id: string) => page.querySelector(`tr[id="${id}"] td`)?.textContent ?? "";

/** Each row's bar as its rank cell says it to a screen reader, by the club's id. */
async function barsOf(rows: FLTabelleRow[]): Promise<Record<string, TableStandingRow["qualifies"]>> {
  const page = await landed({ A: rows });
  const { qualifies } = COPY.shared.season;
  return Object.fromEntries(
    rows.map(({ id }) => {
      const rank = rankOf(page, id);
      return [id, rank.includes(qualifies.settled) ? "settled" : rank.includes(qualifies.level) ? "level" : undefined];
    }),
  );
}

// The mark tells a visitor which clubs go on to the K.-o.-Runde: one place off, or a level pair said as settled, names
// the wrong qualifiers with nothing failing. These cases hear it as a screen reader does; the coloured edge a sighted
// visitor sees beside it is the page's look, which no case here reads.
describe("the Tabelle's spoken qualification mark", () => {
  it("marks the places up to the qualifier count, and none below it", async () => {
    expect(await barsOf([row("a", 1), row("b", 2), row("c", 3), row("d", 4)])).toStrictEqual({
      ["a".repeat(24)]: "settled",
      ["b".repeat(24)]: "settled",
      ["c".repeat(24)]: undefined,
      ["d".repeat(24)]: undefined,
    });
  });

  it("marks a place level clubs share as level, the bracket seeding none of them yet", async () => {
    expect(await barsOf([row("a", 1), row("b", 2), row("c", 2), row("d", 4)])).toStrictEqual({
      ["a".repeat(24)]: "settled",
      ["b".repeat(24)]: "level",
      ["c".repeat(24)]: "level",
      ["d".repeat(24)]: undefined,
    });
  });

  it("marks no club that holds no place", async () => {
    expect(await barsOf([row("a", 1), row("b", null), row("c", null)])).toStrictEqual({
      ["a".repeat(24)]: "settled",
      ["b".repeat(24)]: undefined,
      ["c".repeat(24)]: undefined,
    });
  });
});

// A place is shared only among the clubs of one group: judged across the groups, group B's own first place would make
// group A's sole first club read as level.
describe("the Tabelle's groups", () => {
  it("judges a shared place within its own group", async () => {
    const page = await landed({ A: [row("a", 1), row("b", 2), row("c", 2)], B: [row("d", 1), row("e", 3)] });

    expect(rankOf(page, "a".repeat(24))).toContain(COPY.shared.season.qualifies.settled);
    expect(rankOf(page, "d".repeat(24))).toContain(COPY.shared.season.qualifies.settled);
    expect(rankOf(page, "b".repeat(24))).toContain(COPY.shared.season.qualifies.level);
  });
});
