import { describe, expect, it, vi } from "vitest";

import TabellePage from "./page";

import type { FLTabelleResponse, FLTabelleRow } from "@/core/generated/client/types";
import type { ListPage } from "@/kit/ListPage";
import type { TableRow } from "@/kit/Table";
import type { ComponentProps, ReactElement } from "react";

const STATISTIK = {
  count_abgesagte_spiele: 0,
  count_gespielte_spiele: 3,
  siege: 1,
  unentschieden: 1,
  niederlagen: 1,
  tore_geschossen: 4,
  tore_kassiert: 4,
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

/** The Tabelle each case serves: group A's rows, two qualifying. */
const tabelle = vi.hoisted((): { current: FLTabelleResponse } => ({ current: { gruppen: {}, qualifiers_per_gruppe: 2 } }));

vi.mock("@/features/saisons/queries", () => ({
  getSaisonFrame: async () => ({ saisons: [{ id: "2027" }], active_saison_id: "2027" }),
  getTabelle: async () => tabelle.current,
}));

/** Each row's bar as the page hands it to the table, by the club's id. */
async function barsOf(rows: FLTabelleRow[]): Promise<Record<string, TableRow["qualifies"]>> {
  tabelle.current = { gruppen: { A: rows }, qualifiers_per_gruppe: 2 };
  const page = TabellePage({ params: Promise.resolve({ saison: "2027" }), searchParams: Promise.resolve({}) }) as ReactElement<
    ComponentProps<typeof ListPage>
  >;
  if (page.props.list.kind !== "groups") throw new Error("the Tabelle lists groups");
  const { groups } = await page.props.list.content;
  return Object.fromEntries((groups[0]?.table.rows ?? []).map((each) => [each.id, each.qualifies]));
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
