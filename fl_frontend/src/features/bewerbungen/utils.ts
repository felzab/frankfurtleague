import { parseDate } from "@internationalized/date";

import { medienZuJung } from "@/features/account/einwilligung";
import { isRefusal, isRuleRefusal, refusedPayloadAnswer } from "@/shared/utils/actionError";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import { alterAusserhalb, BEWERBUNG_MAX_ALTER } from "./constants";

import type { FLBewerbung, FLBewerbungEinwilligungViewResponse } from "@/core/generated/client/types";
import type { FieldErrors } from "@/shared/utils/validation";
import type { BewerbungHerkunft } from "./constants";
import type { AdminBewerbungRow, EinwilligungAnsicht, LinkZustand, NamedTeam } from "./types";

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

/** The contact page's age refusal where the link's view serves no floor to name: both bounds, as `alterAusserhalb` names them. */
const GEBURTSDATUM_AUSSERHALB = "Mit diesem Geburtsdatum bist Du für Deine Bestätigung zu jung oder zu alt.";

/** What one refused confirmation shows: a sentence, a field's message, or the panel the link opens on. */
export type EinwilligungRefusal = {
  error?: string;
  fieldErrors?: FieldErrors;
  unplacedError?: string;
  zustand?: LinkZustand | "saison_past";
  /** The view a closed season's page names its cause from, as the read after the refusal answered it. */
  ansicht?: FLBewerbungEinwilligungViewResponse;
};

// A THUNK and never a resolved read: the codes naming one state alone answer without it, and a caller
// reading the view in front of the switch spends a backend read on each of them.
/**
 * A confirmation refusal as what the page should show, or `null` where the code is none of these.
 *
 * The floors are the token's own view's: a number of this mapper's own would be wrong for two of the
 * three seats.
 */
export async function mapEinwilligungRefusal(
  error: unknown,
  gelesen: () => Promise<EinwilligungAnsicht | null>,
): Promise<EinwilligungRefusal | null> {
  if (!isRefusal(error)) return null;

  const ansicht = async () => {
    const link = await gelesen();
    return link?.zustand === "valid" ? link.ansicht : null;
  };
  // The panel a reload opens on, which the press's own panel stands in for where the read finds the link open or reads nothing.
  const stand = async (sonst: LinkZustand | "saison_past"): Promise<EinwilligungRefusal> => {
    const link = await gelesen();
    if (link === null || link.zustand === "valid") return { zustand: sonst };

    // With the read it came from: the page's own read predates the press, and names a team that left since as a
    // season that ended.
    return link.zustand === "saison_past" ? { zustand: link.zustand, ansicht: link.ansicht } : { zustand: link.zustand };
  };

  switch (error.serverErrorCode) {
    // The body shape is mirrored, so a refusal no box can take is of a drifted client, which the
    // mail's link replaces.
    case "body_unreadable":
    case "payload_refused":
      return refusedPayloadAnswer(error, ANTWORT_NEU_OEFFNEN);
    case "link_invalid":
      return { zustand: "invalid" };
    // Judged ahead of the seat and the ban, which the view ranks first: an answer given in another window, or a ban
    // entered since, reads as the view says, and the spent link's panel stands for the rest.
    case "link_expired":
      return stand("expired");
    // A season row's link whose season ended or whose team left, which still takes a Widerspruch, unless the ban the
    // press judges after it bars the address: the view's page either way.
    case "kontakt_saison_past":
      return stand("saison_past");
    // One code covers both answers, so „bestätigt“ here would tell a seat declined in another window
    // that it confirmed. Which way it went is the read's to say.
    case "bewerbung_seat_already_answered":
      return stand("invalid");
    // The one refusal that spends no token, so it lands on the field and the typed date survives it;
    // a `zustand` here would swap a live form for a dead-link panel. A view that went unread names no floor.
    case "confirmation_age": {
      const floor = (await ansicht())?.minimum_age ?? null;
      return { fieldErrors: { birth_date: floor === null ? GEBURTSDATUM_AUSSERHALB : alterAusserhalb(floor) } };
    }
    // Spends nothing either, and the typed date survives it; a toast, the switch rendering no error of its own.
    // The floor is the view's as the age refusal's is, so a view that went unread names none.
    case "media_age":
      return { error: medienNochNicht((await ansicht())?.media_minimum_age ?? null) };
    // The panel the view opens a barred link on, so a ban entered while the form stood open leaves no
    // form either: the page offers no Widerspruch to a barred address.
    case "link_barred":
      return { zustand: "barred" };
    default:
      return null;
  }
}

/** A refused confirmation read as the panel it renders, or `null` where the read failed instead. */
export function mapEinwilligungAnsichtRefusal(error: unknown): LinkZustand | null {
  if (!isRefusal(error)) return null;

  // A token the backend will not parse matches no record, so the page calls the link void rather
  // than offering a reload that cannot succeed. The two
  // tiers bound its length apart.
  if (error.serverErrorCode === "payload_refused") return "invalid";

  // Every rule's refusal alike: a spent link answers its own `zustand` in a 200, so a refusal is a
  // token nothing could place, and a code nobody planned reads the same way.
  return isRuleRefusal(error) ? "invalid" : null;
}
