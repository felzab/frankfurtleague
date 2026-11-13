import { describe, expect, it, vi } from "vitest";

import SpielberichtPage from "./page";

import type { FLSpielberichtSchiedsrichterResponse } from "@/core/generated/client/types";
import type { Option } from "@/kit/OptionList";
import type { ReactElement } from "react";

const SPIEL_ID = "64b000000000000000000001";
const MIA = "64b00000000000000000000a";
const LENA = "64b00000000000000000000b";
const PAUL = "64b00000000000000000000c";
const TOM = "64b00000000000000000000d";

const pupil = (spieler_id: string, nummer: string, first_name: string) => ({ spieler_id, nummer, first_name, last_name: "Muster" });

/**
 * A played fixture whose report was written before the knockout correction put Birke on side 1 in Ahorn's place: its
 * goal names Ahorn's Mia. On side 2, the club unchanged, its card names Lena, who has since left the squad.
 */
const READ: FLSpielberichtSchiedsrichterResponse = {
  spiel: {
    spiel_id: SPIEL_ID,
    saison_id: "2027",
    saison_phase: "viertelfinale",
    date: "2026-10-27",
    time: "15:00:00",
    team1: { team_id: "64b000000000000000000004", name: "Birke", shorthand: "BIR" },
    team2: { team_id: "64b000000000000000000003", name: "Kastanie", shorthand: "KAS" },
    spielort: null,
    sonderereignis: null,
  },
  kader: { team1: [pupil(PAUL, "4", "Paul")], team2: [pupil(TOM, "8", "Tom")] },
  named: [pupil(MIA, "9", "Mia"), pupil(LENA, "7", "Lena")],
  bericht: {
    ergebnis_vorschlag: { team1_tore: 1, team2_tore: 0, elfmeterschiessen: null, sonderereignis: null },
    scorers: [{ side: "team1", spieler_id: MIA, minute: "12", eigentor: false }],
    cards: [{ side: "team2", spieler_id: LENA, minute: "40", colour: "gelb" }],
    remarks: null,
    sides: { team1: "64b000000000000000000002", team2: "64b000000000000000000003" },
    submitted_at: "2026-10-27T17:00:00Z",
    adopted: false,
  },
  sides_changed: ["team1"],
  completed: false,
  reportable: true,
  version: 3,
};

vi.mock("@/features/roles/resolvers", () => ({
  requireRole: () => Promise.resolve({}),
  readAsRoleHolder: <Read,>(_kind: string, read: () => Promise<Read>) => read(),
}));
vi.mock("@/features/spielberichte/queries", () => ({ getOwnSpielbericht: () => Promise.resolve(READ) }));
vi.mock("@/features/saisons/queries", () => ({ getSaisonFrame: () => Promise.resolve({ saisons: [] }) }));

/** The pupils each side's player lists offer, each by id and whether it can be picked. */
async function offered() {
  const page = (await SpielberichtPage({ params: Promise.resolve({ saison: "2027", spiel: SPIEL_ID }) } as Parameters<
    typeof SpielberichtPage
  >[0])) as ReactElement<{
    squads: Record<"team1" | "team2", Option[]>;
  }>;
  const { squads } = page.props;
  const of = (options: readonly Option[]) => options.map(({ id, isDisabled }) => ({ id, disabled: isDisabled === true }));
  return { team1: of(squads.team1), team2: of(squads.team2) };
}

/* A side fielding another club since the report was written has emptied the rows naming the departed club's pupils, so
   those pupils offered under „Ausgetragen“ name nobody the club playing ever deregistered, and nothing else shows it. */
describe("the player lists", () => {
  it("offer a changed side's squad alone, and keep a deregistered pupil a row names on a side unchanged", async () => {
    expect(await offered()).toStrictEqual({
      team1: [{ id: PAUL, disabled: false }],
      team2: [
        { id: TOM, disabled: false },
        { id: LENA, disabled: true },
      ],
    });
  });
});
