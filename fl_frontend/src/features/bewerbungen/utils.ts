import { parseDate } from "@internationalized/date";

import { medienZuJung } from "@/features/account/einwilligung";

import { BEWERBUNG_MAX_ALTER } from "./constants";

import type { FLBewerbung } from "@/core/generated/client/types";
import type { BewerbungHerkunft } from "./constants";
import type { AdminBewerbungRow, NamedTeam } from "./types";

/**
 * The club an application is about: the proposed school's own name, or the picked club's.
 *
 * **One rule, one place**: the list renders it and the outbound message is addressed with it. `null`
 * where it names neither, the row `bewerbung_subject_unresolved` refuses.
 */
export function bewerbungTeamName(bewerbung: Pick<FLBewerbung, "schule" | "team_id">, teams: readonly NamedTeam[]): string | null {
  if (bewerbung.schule !== null) return bewerbung.schule.team_name;
  if (bewerbung.team_id === null) return null;

  return teams.find((team) => team.id === bewerbung.team_id)?.name ?? null;
}

/**
 * Which of the two an application is, or `null` where it names neither — the row `bewerbung_subject_unresolved` refuses, which no
 * surface may file under either. The school is asked first: an accepted one names the club it created too.
 */
export function bewerbungHerkunft(bewerbung: Pick<FLBewerbung, "schule" | "team_id">): BewerbungHerkunft | null {
  if (bewerbung.schule !== null) return "neue_schule";

  return bewerbung.team_id === null ? null : "bestehendes_team";
}

/**
 * The triage list, each application carrying the club it names and whether it stands in the SELECTED
 * season. Assembled here because a picked club is stored as an id, and a queue of ids is one nobody
 * can work down.
 */
export function buildBewerbungRows(
  bewerbungen: readonly FLBewerbung[],
  teams: readonly NamedTeam[],
  selectedSaisonId: string | undefined,
): AdminBewerbungRow[] {
  return bewerbungen.map((bewerbung) => ({
    ...bewerbung,
    teamName: bewerbungTeamName(bewerbung, teams),
    inSelectedSaison: bewerbung.saison_id === selectedSaisonId,
  }));
}

/**
 * What one acceptance did, a whole sentence per branch. Never a shared prefix with a spliced tail:
 * the two branches take different verbs, and only one of them composes.
 */
export function describeAufnahme({ createdTeam, gruppe, saisonId }: { createdTeam: boolean; gruppe: string; saisonId: string }): string {
  return createdTeam
    ? `Das Team wurde angelegt und in Gruppe ${gruppe} der Saison ${saisonId} aufgenommen.`
    : `Das Team wurde in Gruppe ${gruppe} der Saison ${saisonId} aufgenommen.`;
}

/**
 * Bounds rather than an age: a date control takes a `minValue` and a schema a string comparison, so
 * one derivation serves both. The floor is the seat's, which the link's own read answers
 * (`fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungEinwilligungViewResponse`).
 */
export function geburtsdatumSpanne(today: string, mindestalter: number): { frueheste: string; spaeteste: string } {
  const heute = parseDate(today);

  // The day AFTER one year past the ceiling: `fl_backend/app/shared/age.py :: whole_years_between`
  // accepts a birthday not yet reached this year, and a calendar subtraction clamps 29 February onto
  // the day before 1 March where that year has none.
  return {
    frueheste: heute
      .subtract({ years: BEWERBUNG_MAX_ALTER + 1 })
      .add({ days: 1 })
      .toString(),
    spaeteste: heute.subtract({ years: mindestalter }).toString(),
  };
}

// The switch rather than the date is the repair: each confirmation page offers it from the served age
// on the browser's German day, so only a clock disagreeing with the backend's shows it below that age.
const MEDIEN_AUSSCHALTEN = "Schalte die Erlaubnis aus und bestätige erneut.";

/** A confirmation page's media refusal where the link's view serves no floor to name. */
export const MEDIEN_NOCH_NICHT = `Fotos, Videos und Interviews kannst Du mit diesem Geburtsdatum noch nicht erlauben. ${MEDIEN_AUSSCHALTEN}`;

/** Every confirmation page's media refusal, at the floor its link's view serves, or naming none where it went unread. */
export const medienNochNicht = (medienMindestalter: number | null): string =>
  medienMindestalter === null ? MEDIEN_NOCH_NICHT : `${medienZuJung(medienMindestalter)} ${MEDIEN_AUSSCHALTEN}`;
