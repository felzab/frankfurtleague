import type { CalendarDay, Uhrzeit } from "@/core/format";
import type { FLSonderereignis, FLSpielJoinedAdmin } from "@/core/generated/client/types";

/** The Sonderereignis select's first entry, which saves as no event. */
export const NO_SONDEREREIGNIS = "keines";

/**
 * What the match editor's fields hold: a knockout match's two clubs, picked by hand; the Ansetzung's day, time, venue
 * and its price, referee and their fee; whether a result is entered, its goals and a shoot-out's; the Sonderereignis'
 * choice; the note. A figure is the text typed, read as one by the save.
 */
export type SpielValues = {
  team1: string | null;
  team2: string | null;
  datum: CalendarDay | null;
  uhrzeit: Uhrzeit | null;
  spielort: string | null;
  mietpreis: string;
  schiedsrichter: string | null;
  honorar: string;
  hasResult: boolean;
  tore1: string;
  tore2: string;
  shootOut1: string;
  shootOut2: string;
  sonderereignis: string;
  notiz: string;
};

/** A no-show, whose goals the write composes from the season's rules rather than taking any typed. */
export const isNoShow = (sonderereignis: FLSonderereignis | string | null) =>
  sonderereignis === "nichtantreten_team1" || sonderereignis === "nichtantreten_team2";

/** An event after which the match carries no result at all, which the write refuses goals beside. */
export const takesNoResult = (sonderereignis: FLSonderereignis | string | null) =>
  sonderereignis === "ausgefallen" || sonderereignis === "annulliert";

const figure = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));

/**
 * The editor's values as a stored fixture gives them. A no-show's goals are the award the write composed, never a
 * result anyone entered, so its result control rests unticked.
 */
export function valuesOf(spiel: FLSpielJoinedAdmin): SpielValues {
  const hasResult = spiel.ergebnis !== null && !isNoShow(spiel.sonderereignis);
  return {
    team1: spiel.team1?.team_id ?? null,
    team2: spiel.team2?.team_id ?? null,
    // Both already parsed as a calendar day and a time of day by the read's schema.
    datum: spiel.datum as SpielValues["datum"],
    uhrzeit: spiel.uhrzeit as SpielValues["uhrzeit"],
    spielort: spiel.ort?.spielort_id ?? null,
    mietpreis: figure(spiel.ort?.mietpreis),
    schiedsrichter: spiel.schiedsrichter?.schiedsrichter_id ?? null,
    honorar: figure(spiel.schiedsrichter?.payment),
    hasResult,
    tore1: hasResult ? figure(spiel.team1?.tore) : "",
    tore2: hasResult ? figure(spiel.team2?.tore) : "",
    shootOut1: figure(spiel.elfmeterschiessen?.team1),
    shootOut2: figure(spiel.elfmeterschiessen?.team2),
    sonderereignis: spiel.sonderereignis ?? NO_SONDEREREIGNIS,
    notiz: spiel.notiz ?? "",
  };
}
