// @vitest-environment jsdom
import { prerender } from "react-dom/static";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";
import { serveBackend } from "@/test-support/backend";
import { underNext } from "@/test-support/nextContexts";
import { doubleNextRequest } from "@/test-support/nextRequest";

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
  const { prelude } = await prerender(
    underNext(
      <TabellePage
        params={Promise.resolve({ saison: "2027" })}
        searchParams={Promise.resolve({})}
      />,
      { pathname: "/saisons/2027/tabelle" },
    ),
    { progressiveChunkSize: Number.MAX_SAFE_INTEGER },
  );
  const page = document.createElement("div");
  page.innerHTML = await new Response(prelude).text();
  return page;
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

// The bar tells a visitor which clubs go on to the K.-o.-Runde: one place off, or a level pair drawn as settled,
// shows the wrong qualifiers with nothing failing.
describe("the Tabelle's qualification bar", () => {
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

// The edge is a colour alone: a sighted visitor learns what it and the other marks mean only behind the ⓘ, and a
// screen reader hears none of it but these words.
describe("the Tabelle's marks", () => {
  it("say the edge's tones to a screen reader", async () => {
    const page = await landed({ A: [row("a", 1), row("b", 2), row("c", 2)], B: [row("d", 1), row("e", 3)] });

    expect(rankOf(page, "a".repeat(24))).toContain(COPY.shared.season.qualifies.settled);
    expect(rankOf(page, "b".repeat(24))).toContain(COPY.shared.season.qualifies.level);
    expect(rankOf(page, "e".repeat(24))).not.toContain(COPY.shared.season.qualifies.settled);
  });
});
