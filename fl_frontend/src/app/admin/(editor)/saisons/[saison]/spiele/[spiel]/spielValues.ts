import { isNoShow } from "@/features/spiele/result";

import type { CalendarDay, TimeOfDay } from "@/core/format";
import type { FLSonderereignis, FLSpielJoinedAdmin } from "@/core/generated/client/types";

/** The Sonderereignis select's first entry, which saves as no event. */
export const NO_SONDEREREIGNIS = "none";

/**
 * What the match editor's fields hold: a knockout match's two clubs, picked by hand; the Ansetzung's day, time, venue
 * and its price, referee and their fee; whether a result is entered, its goals and a shoot-out's; the Sonderereignis'
 * choice; the note. A figure is the text typed, read as one by the save.
 */
export type SpielValues = {
  team1: string | null;
  team2: string | null;
  date: CalendarDay | null;
  time: TimeOfDay | null;
  spielort: string | null;
  mietpreis: string;
  schiedsrichter: string | null;
  payment: string;
  hasResult: boolean;
  tore1: string;
  tore2: string;
  shootOut1: string;
  shootOut2: string;
  sonderereignis: string;
  note: string;
};

/** An event after which the match carries no result at all, which the write refuses goals beside. */
export const takesNoResult = (sonderereignis: FLSonderereignis | string | null) =>
  sonderereignis === "ausgefallen" || sonderereignis === "annulliert";

/** The referee's proposal as „Übernehmen“ carries it into the result's fields, and the report's version it stamps. */
export type Proposal = { version: number; values: Partial<SpielValues> };

/** Whether these values still hold the proposal, every field it sets at the value it sets. */
export const holdsProposal = (proposal: Proposal | null, values: SpielValues) =>
  proposal !== null && Object.entries(proposal.values).every(([key, value]) => values[key as keyof SpielValues] === value);

/**
 * The report's version a save stamps adopted: only once „Übernehmen“ was pressed, and only while the values the save
 * stores still hold its proposal, so a result changed after it is never recorded as the report's; else none.
 */
export const adoptsBerichtOf = (proposal: Proposal | null, pressed: boolean, saved: SpielValues): number | null =>
  pressed && proposal !== null && holdsProposal(proposal, saved) ? proposal.version : null;

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
    date: spiel.date as SpielValues["date"],
    time: spiel.time as SpielValues["time"],
    spielort: spiel.spielort?.spielort_id ?? null,
    mietpreis: figure(spiel.spielort?.mietpreis),
    schiedsrichter: spiel.schiedsrichter?.schiedsrichter_id ?? null,
    payment: figure(spiel.schiedsrichter?.payment),
    hasResult,
    tore1: hasResult ? figure(spiel.team1?.tore) : "",
    tore2: hasResult ? figure(spiel.team2?.tore) : "",
    shootOut1: figure(spiel.elfmeterschiessen?.team1),
    shootOut2: figure(spiel.elfmeterschiessen?.team2),
    sonderereignis: spiel.sonderereignis ?? NO_SONDEREREIGNIS,
    note: spiel.note ?? "",
  };
}
