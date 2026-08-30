import { LIGA_EINWILLIGUNG } from "@/core/einwilligung";
import { APIBadStatusError } from "@/core/errors";
import { buildRefusal } from "@/shared/utils/refusal";
import { mirrorTrainerSeat } from "@/shared/utils/trainerSeat";

import { BEWERBUNG_MAX_ALTER, BEWERBUNG_MIN_ALTER, KUERZEL_LAENGE, SCHULE_NICHT_IN_LISTE } from "./constants";

import type { FLTrainerZugleich } from "@/features/teams/schemas";
import type { FieldErrors } from "@/shared/utils/validation";
import type { FLBewerbung, FLBewerbungFensterResponse } from "./schemas";
import type {
  AdminBewerbungRow,
  BewerbungFormDraft,
  BewerbungKontakteDraft,
  BewerbungKontaktpersonDraft,
  BewerbungSchuleDraft,
  FensterZustand,
  KuerzelVerdikt,
  NamedTeam,
} from "./types";

/**
 * The ONE answer a taken Kürzel gets, wherever it is judged. It names no club and does not say
 * whether that club still plays: the check is open to anybody, and either would be a read of the
 * league's roster nobody asked it for.
 */
export const KUERZEL_VERGEBEN = "Dieses Kürzel ist schon vergeben. Bitte wähle ein anderes.";

/** The three things the blur-time check has to say short of a refusal. */
export const KUERZEL_PRUEFUNG = "Wir prüfen, ob das Kürzel noch frei ist...";
const KUERZEL_FREI = "Dieses Kürzel ist noch frei.";
export const KUERZEL_UNGEPRUEFT = "Ob das Kürzel frei ist, prüfen wir spätestens beim Abschicken.";

/**
 * What the blur-time check has to say about the code in the box right now.
 *
 * A TAKEN code is left to the field error: it is the one answer that stops a submission, and two
 * channels stating it would say it twice.
 */
export function kuerzelHinweis(shorthand: string, verdikt: KuerzelVerdikt | null, isPending: boolean): string | null {
  if (shorthand.length !== KUERZEL_LAENGE) return null;
  if (isPending) return KUERZEL_PRUEFUNG;
  // A verdict about another value says nothing about this one, whatever it said about that one.
  if (verdikt === null || verdikt.shorthand !== shorthand) return KUERZEL_UNGEPRUEFT;

  return verdikt.vergeben ? null : KUERZEL_FREI;
}

/**
 * The club an application is about: the proposed school's own name, or the picked club's.
 *
 * **One rule, one place**: the list renders it and the outbound message is addressed with it. `null`
 * where it names neither, the row `REQ-BEWERBUNG-002` refuses.
 */
export function bewerbungTeamName(bewerbung: Pick<FLBewerbung, "schule" | "team_id">, teams: readonly NamedTeam[]): string | null {
  if (bewerbung.schule !== null) return bewerbung.schule.team_name;
  if (bewerbung.team_id === null) return null;

  return teams.find((team) => team.id === bewerbung.team_id)?.name ?? null;
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
 * The window a contact person's birthdate has to fall in, as its two `YYYY-MM-DD` bounds.
 *
 * Bounds rather than an age: the picker needs a `minValue` and the schema a string comparison, so
 * one derivation serves both and neither can drift.
 */
export function geburtsdatumSpanne(today: string): { frueheste: string; spaeteste: string } {
  const [jahr = "1970", rest = "01-01"] = [today.slice(0, 4), today.slice(5)];
  const verschoben = (jahre: number) => `${String(Number(jahr) - jahre).padStart(4, "0")}-${rest}`;

  // Both bounds are multiples of four years, so a 29 February lands on a leap year either way.
  return { frueheste: verschoben(BEWERBUNG_MAX_ALTER), spaeteste: verschoben(BEWERBUNG_MIN_ALTER) };
}

/**
 * A submission 409 as what the form should show, or `null` where the code is none of these.
 *
 * A refusal naming a field goes to that field's dotted path, so it lands under the control at
 * fault; the two that name none reach the applicant as a banner.
 */
export function mapBewerbungSubmitRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError)) return null;

  // A body rule Pydantic holds that this mirror does not. The answer is the same every time, so the
  // generic „Versuche es erneut“ invites a retry that cannot work; `REQ-VAL-001` names no field, so
  // this is a banner.
  if (error.statusCode === 422) {
    return {
      error: buildRefusal({
        reason: "Einzelne Angaben konnten wir nicht übernehmen",
        repair: "Prüfe die Telefonnummern und die E-Mail-Adressen der drei Kontaktpersonen",
      }),
    };
  }

  if (error.statusCode !== 409) return null;

  switch (error.serverErrorCode) {
    // The window closed between the page loading and this press. A reload is the whole remedy: the
    // page then says so itself instead of offering a form nothing accepts.
    case "REQ-BEWERBUNG-004":
      return {
        error: buildRefusal({
          reason: "Für diese Saison werden gerade keine Bewerbungen angenommen",
          repair: "Lade die Seite neu",
        }),
      };
    case "REQ-BEWERBUNG-005":
      return { fieldErrors: { team_id: "Wähle entweder eine bestehende Schule aus oder trage eine neue ein, nicht beides." } };
    // Reload-and-pick leads: this is reachable only for an id the picker never offered. The new-school
    // arm names a free Kürzel so nobody walks into `-008`, and says nothing about why the club went,
    // which is what `READ-BEWERBUNG-001` asks of it.
    case "REQ-BEWERBUNG-006":
      return {
        fieldErrors: {
          team_id:
            "Diese Auswahl gilt nicht mehr. Lade die Seite neu und wähle erneut aus. Oder trage die Schule neu ein, mit einem noch freien Kürzel.",
        },
      };
    // The club is IN the season, not the subject of a second application: the two read alike and
    // only one of them is what the backend refused.
    case "REQ-BEWERBUNG-007":
      return { fieldErrors: { team_id: "Diese Schule spielt in dieser Saison schon mit. Wähle eine andere aus, wenn Du Dich vertan hast." } };
    // The same neutral answer the availability check gives: it names no club and says nothing about
    // whether the club holding the code still plays.
    case "REQ-BEWERBUNG-008":
      return { fieldErrors: { "schule.shorthand": KUERZEL_VERGEBEN } };
    default:
      return null;
  }
}

/**
 * Which state a season's window puts the page in.
 *
 * `laeuft` is the server's whole judgement and is never re-derived here. The four closed answers are
 * four different sentences: a school told the wrong one goes away for the wrong reason.
 */
export function fensterZustand(fenster: FLBewerbungFensterResponse | null, today: string): FensterZustand {
  if (fenster === null) return "keine-frist";
  if (fenster.laeuft) return "laeuft";
  // Before either date: the league closed it, which is not the same as a deadline passing.
  if (!fenster.offen) return "geschlossen";
  if (today < fenster.von) return "noch-nicht";

  // Never `vorbei` by default: `laeuft` is false with the span still open only where this clock and
  // the server's disagree, and "abgelaufen" would then be a deadline nobody has reached.
  return today > fenster.bis ? "vorbei" : "geschlossen";
}

/**
 * The Abitur year a season fields.
 *
 * **A season id IS the calendar year it plays in**, never two halves of a school year: `2026` runs
 * 2026-03-07 to 2026-10-31, one summer inside the year its id spells.
 */
export function abiJahrgang(saisonId: string): string {
  return String(Number(saisonId) + 1);
}

/** One blank contact person, for the moment the form is opened. */
export const buildEmptyBewerbungKontaktperson = (): BewerbungKontaktpersonDraft => ({
  vorname: "",
  nachname: "",
  email: "",
  telefon: "",
  geburtsdatum: "",
  // The wording's version is written by the form rather than typed: the text lives in the frontend
  // and is versioned there, so what a record cites is what its reader was actually shown.
  einwilligung: { text_version: LIGA_EINWILLIGUNG.textVersion, erteilt: false },
});

/** A blank new school, held from the moment the form opens so nothing typed into it can be dropped. */
export const buildEmptyBewerbungSchule = (): BewerbungSchuleDraft => ({
  team_name: "",
  full_name: "",
  shorthand: "",
  schulform: null,
  address: { strasse: "", hausnummer: "", plz: "", stadtteil: "", stadt: "" },
  // `null` and not `""`: the box starts empty either way, and this is the one spelling of "no
  // website" the product writes, so a submission never carries two of them.
  website_url: null,
});

/** The whole form as it opens: one season, nobody picked, three blank people. */
export const buildEmptyBewerbungDraft = (saisonId: string): BewerbungFormDraft => ({
  saison_id: saisonId,
  auswahl: null,
  schule: buildEmptyBewerbungSchule(),
  kontakte: {
    trainer: buildEmptyBewerbungKontaktperson(),
    ansprechperson: buildEmptyBewerbungKontaktperson(),
    stellvertretung: buildEmptyBewerbungKontaktperson(),
    trainer_ist_zugleich: null,
  },
  trikot: { vorhandener_satz: "", wunschfarbe: null },
  kader: { voraussichtliche_groesse: null, gute_spieler: null },
});

/**
 * The Trainer seat, filled from the seat that declared itself the coach.
 *
 * **Seat to Trainer**: the question is asked where the person is entered, so that seat is the source
 * and the coach's boxes the reading.
 */
export function mirrorBewerbungTrainer(kontakte: BewerbungKontakteDraft): BewerbungKontakteDraft {
  return mirrorTrainerSeat(kontakte);
}

/**
 * Whether the picker's key stands for „meine Schule ist nicht dabei“ rather than for a club.
 *
 * One reading of the sentinel, so the form, the payload and the divider cannot disagree about which
 * arm the applicant is in.
 */
export function istNeueSchule(auswahl: string | null): boolean {
  return auswahl === SCHULE_NICHT_IN_LISTE;
}

/**
 * The draft as the submission spells it.
 *
 * **Both school arms are derived from the one picked key**, so nothing composed here can name a club
 * and a new school at once — the shape `REQ-BEWERBUNG-005` refuses.
 */
export function bewerbungPayload(draft: BewerbungFormDraft) {
  const neu = istNeueSchule(draft.auswahl);

  return {
    saison_id: draft.saison_id,
    team_id: neu ? null : draft.auswahl,
    schule: neu ? draft.schule : null,
    // Mirrored on the way OUT rather than into state: the seat that declared itself the coach stays
    // the one place the person is edited, so nothing can drift between the two copies.
    kontakte: mirrorBewerbungTrainer(draft.kontakte),
    trikot: draft.trikot,
    kader: draft.kader,
  };
}

/**
 * The paths one judgement covers. While the mirror stands, the Trainer seat holds the named seat's
 * person, so judging that seat's field alone leaves the copy's verdict over a value it never saw.
 */
export function bewerbungJudgedPaths(paths: readonly string[], mirroredSeat: FLTrainerZugleich | null): readonly string[] {
  if (mirroredSeat === null) return paths;

  const copies = paths
    .filter((path) => path.startsWith(`kontakte.${mirroredSeat}.`))
    .map((path) => path.replace(`kontakte.${mirroredSeat}.`, "kontakte.trainer."));

  return copies.length === 0 ? paths : [...paths, ...copies];
}
