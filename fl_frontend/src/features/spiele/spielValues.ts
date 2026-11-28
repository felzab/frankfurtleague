import { admitsShootOut, isNoShow } from "./result";

import type { CalendarDay, TimeOfDay } from "@/core/format";
import type { FLSaisonPhase, FLSonderereignis, FLSpielJoinedAdmin } from "@/core/generated/client/types";

/**
 * The referee field's entry for a booking naming nobody, which a played match keeps with its fee once its referee was
 * erased: a combo box's choice is a string, and the write takes this one as a null referee.
 */
export const NOBODY = "nobody";

/**
 * What the match editor's fields hold: a knockout match's two clubs, picked by hand; the Ansetzung's day, time, venue
 * and its price, referee and their fee; whether a result is entered, its goals and a shoot-out's; the Sonderereignis'
 * choice, `""` for „Keines“, which the save reads as no event; the note. A figure is the text typed, read as one by the
 * save.
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
export const takesNoResult = (sonderereignis: string | null) => sonderereignis === "ausgefallen" || sonderereignis === "annulliert";

/** A figure as a box holds it, the text typed, or as the save reads it, a number; empty as `""` or `null`. */
type Figure = string | number | null;

/** The match's values `requiredOf` judges, a figure as typed or as read, no event as `null` or `""`. */
export type RequiredValues = Pick<SpielValues, "team1" | "team2" | "spielort" | "schiedsrichter" | "hasResult"> & {
  readonly [Box in "mietpreis" | "payment" | "tore1" | "tore2" | "shootOut1" | "shootOut2"]: Figure;
} & { readonly sonderereignis: FLSonderereignis | "" | null };

const isBlank = (value: Figure) => value === null || value === "";

/**
 * The boxes a save needs filled that are empty, by the editor's field names, judged on the fixture's values with the
 * editor's changes over them, and the phase of its season: a booking's price and fee while it is made, an entered
 * result's two goals, and a shoot-out's two figures once either is typed where the fixture takes one. The editor's
 * draft holds the same values, so the browser's pass asks the same.
 */
export function requiredOf(values: RequiredValues, saisonPhase: FLSaisonPhase): readonly (keyof RequiredValues)[] {
  const event = values.sonderereignis === "" ? null : values.sonderereignis;
  const scored = values.hasResult && !isNoShow(event) && !takesNoResult(event);
  const sideOf = (team: string | null, tore: Figure) => (team === null ? null : { tore: scored && !isBlank(tore) ? Number(tore) : null });
  // One typed before the goals moved off level is dropped, as the write drops it, so it is judged only where it stands.
  const takesShootOut = admitsShootOut(saisonPhase, sideOf(values.team1, values.tore1), sideOf(values.team2, values.tore2), event);
  const shootOutTyped = takesShootOut && (!isBlank(values.shootOut1) || !isBlank(values.shootOut2));
  const needed: readonly [keyof RequiredValues, boolean][] = [
    ["mietpreis", values.spielort !== null && isBlank(values.mietpreis)],
    ["payment", values.schiedsrichter !== null && isBlank(values.payment)],
    ["tore1", scored && isBlank(values.tore1)],
    ["tore2", scored && isBlank(values.tore2)],
    ["shootOut1", shootOutTyped && isBlank(values.shootOut1)],
    ["shootOut2", shootOutTyped && isBlank(values.shootOut2)],
  ];
  return needed.flatMap(([box, empty]) => (empty ? [box] : []));
}

/** The referee's proposal as „Übernehmen“ carries it into the result's fields, and the report's version it stamps. */
export type Proposal = { version: number; values: Partial<SpielValues> };

/** Whether these values still hold the proposal, every field it sets at the value it sets. */
const holdsProposal = (proposal: Proposal | null, values: SpielValues) =>
  proposal !== null && Object.entries(proposal.values).every(([key, value]) => values[key as keyof SpielValues] === value);

/**
 * The report's version a save stamps adopted: only once „Übernehmen“ was pressed, and only while the values the save
 * stores still hold its proposal, so a result changed after it is never recorded as the report's; else none.
 */
export const adoptsBerichtOf = (proposal: Proposal | null, pressed: boolean, saved: SpielValues): number | null =>
  pressed && proposal !== null && holdsProposal(proposal, saved) ? proposal.version : null;

const figure = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));

/**
 * A no-show's goals are the award the write composed, never a result anyone entered, so its result control rests
 * unticked.
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
    schiedsrichter: spiel.schiedsrichter === null ? null : (spiel.schiedsrichter.schiedsrichter_id ?? NOBODY),
    payment: figure(spiel.schiedsrichter?.payment),
    hasResult,
    tore1: hasResult ? figure(spiel.team1?.tore) : "",
    tore2: hasResult ? figure(spiel.team2?.tore) : "",
    shootOut1: figure(spiel.elfmeterschiessen?.team1),
    shootOut2: figure(spiel.elfmeterschiessen?.team2),
    sonderereignis: spiel.sonderereignis ?? "",
    note: spiel.note ?? "",
  };
}
