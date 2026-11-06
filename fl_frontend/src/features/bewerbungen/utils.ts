import { parseDate } from "@internationalized/date";

import { KONTAKT_EMAIL } from "@/core/brand";
import { medienZuJung } from "@/features/account/einwilligung";
import { isRefusal, refusedPayloadAnswer } from "@/shared/utils/actionError";
import { buildRefusal, LADE_DIE_SEITE_NEU, LADE_NEU_UND_VERSUCHE_ES_ERNEUT } from "@/shared/utils/refusal";
import { mirrorTrainerSeat } from "@/shared/utils/trainerSeat";

import { BEWERBUNG_MAX_ALTER, SCHULE_NICHT_IN_LISTE } from "./constants";

import type { FLBewerbungWindowResponse, FLTrainerAlso } from "@/core/generated/client/types";
import type { FieldErrors } from "@/shared/utils/validation";
import type { BewerbungFormDraft, BewerbungKontakteDraft, BewerbungKontaktpersonDraft, BewerbungSchuleDraft, FensterZustand } from "./types";

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

/** A body the running API refuses on a path no box takes, which only a page older than the deploy sends. */
export const BEWERBUNG_VERALTET = buildRefusal({
  reason: "Einzelne Angaben konnten wir nicht übernehmen",
  repair: LADE_NEU_UND_VERSUCHE_ES_ERNEUT,
});

/**
 * A submission refusal as what the form should show, or `null` where the code is none of these: a
 * refusal naming a field lands under the control at fault, and the rest reach the applicant as a sentence.
 */
export function mapBewerbungSubmitRefusal(
  error: unknown,
): { error?: string; fieldErrors?: FieldErrors; unplacedError?: string; schonAngekommen?: true } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // Every body rule the form can break is mirrored, so a refusal no box can take is of a drifted
    // client, which a reload replaces.
    case "body_unreadable":
    case "payload_refused":
      return refusedPayloadAnswer(error, BEWERBUNG_VERALTET);
    // The window closed between the page loading and this press. A reload is the whole remedy: the
    // page then says so itself instead of offering a form nothing accepts.
    case "bewerbung_window_closed":
      return {
        error: buildRefusal({
          reason: "Für diese Saison werden gerade keine Bewerbungen angenommen",
          repair: LADE_DIE_SEITE_NEU,
        }),
      };
    case "bewerbung_submission_subject_unresolved":
      return { fieldErrors: { team_id: "Wähle entweder eine bestehende Schule aus oder trage eine neue ein, nicht beides." } };
    // Reload-and-pick leads: this is reachable only for an id the picker never offered, and it says nothing
    // about why the club went, which is what `READ-BEWERBUNG-001` asks of it.
    case "bewerbung_picked_team_unusable":
      return {
        fieldErrors: {
          team_id: "Diese Auswahl gilt nicht mehr. Lade die Seite neu, oder trage die Schule mit einem noch freien Kürzel neu ein.",
        },
      };
    // The club is IN the season, not the subject of a second application: the two read alike and
    // only one of them is what the backend refused.
    case "bewerbung_picked_team_already_entered":
      return { fieldErrors: { team_id: "Diese Schule spielt in dieser Saison schon mit." } };
    // The press this form repeated stands, under the details first sent: a banner rather than a
    // field, since whichever box changed since then is not the one at fault.
    case "bewerbung_key_differing":
      return {
        schonAngekommen: true,
        error: buildRefusal({
          reason: "Deine Bewerbung ist schon angekommen, mit den Angaben, die Du zuerst abgeschickt hast",
          repair: `Soll sich daran etwas ändern, schreib uns an ${KONTAKT_EMAIL}`,
        }),
      };
    // A banner naming no seat, as a 403 carries no field, and neutral as the registration's is: a
    // stranger learns nothing about a list, and the person it concerns already knows why.
    case "bewerbung_address_barred":
      return {
        error: buildRefusal({
          reason: "Mit einer der angegebenen E-Mail-Adressen ist keine Bewerbung möglich",
          repair: `Wenn Du das für einen Fehler hältst, schreib uns an ${KONTAKT_EMAIL}`,
        }),
      };
    // With the record missing, the season this page names is one the running API does not hold: only a
    // page from before a data reset, or a crafted body, sends it, and the reload fetches the window open now.
    case "document_not_found":
      return { error: BEWERBUNG_VERALTET };
    default:
      return null;
  }
}

// The switch rather than the date is the repair: each confirmation page offers it from the served age
// on the browser's German day, so only a clock disagreeing with the backend's shows it below that age.
const MEDIEN_AUSSCHALTEN = "Schalte die Erlaubnis aus und bestätige erneut.";

/** A confirmation page's media refusal where the link's view serves no floor to name. */
export const MEDIEN_NOCH_NICHT = `Fotos, Videos und Interviews kannst Du mit diesem Geburtsdatum noch nicht erlauben. ${MEDIEN_AUSSCHALTEN}`;

/** Every confirmation page's media refusal, at the floor its link's view serves, or naming none where it went unread. */
export const medienNochNicht = (medienMindestalter: number | null): string =>
  medienMindestalter === null ? MEDIEN_NOCH_NICHT : `${medienZuJung(medienMindestalter)} ${MEDIEN_AUSSCHALTEN}`;

/**
 * Which state a season's window puts the page in.
 *
 * `laeuft` is the server's whole judgement and is never re-derived here. The four closed answers are
 * four different sentences: a school told the wrong one goes away for the wrong reason.
 */
export function fensterZustand(fenster: FLBewerbungWindowResponse | null, today: string): FensterZustand {
  if (fenster === null) return "keine-frist";
  if (fenster.running) return "running";
  // Ahead of every date answer: an ended season takes no application again, so „gerade geschlossen“
  // or „noch nicht offen“ would send a school to wait for a window that never reopens.
  if (fenster.saison_ended) return "vorbei";
  if (today < fenster.start) return "noch-nicht";

  // Never `vorbei` by default: `laeuft` is false with the span still open where this clock and the
  // server's disagree, and "abgelaufen" would name a deadline nobody reached.
  return today > fenster.end ? "vorbei" : "closed";
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

const buildEmptyBewerbungKontaktperson = (): BewerbungKontaktpersonDraft => ({
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  einwilligung: { given: false },
});

/** A blank new school, held from the moment the form opens so nothing typed into it can be dropped. */
const buildEmptyBewerbungSchule = (): BewerbungSchuleDraft => ({
  team_name: "",
  full_name: "",
  schulform: null,
  address: { strasse: "", hausnummer: "", plz: "", stadtteil: "", stadt: "" },
  // `null` and not `""`: the box starts empty either way, and this is the one spelling of "no
  // website" the product writes, so a submission never carries two of them.
  website_url: null,
});

export const buildEmptyBewerbungDraft = (saisonId: string): BewerbungFormDraft => ({
  saison_id: saisonId,
  auswahl: null,
  schule: buildEmptyBewerbungSchule(),
  kontakte: {
    trainer: buildEmptyBewerbungKontaktperson(),
    ansprechperson: buildEmptyBewerbungKontaktperson(),
    stellvertretung: buildEmptyBewerbungKontaktperson(),
    trainer_is_also: null,
  },
  trikot: { existing_satz: "", wunschfarbe: null },
  kader: { expected_size: null, good_spieler: null },
  stufengroesse: null,
  wunschgegner: "",
});

/**
 * **Seat to Trainer**: the claim is answered on the Trainer's panel, last of the three, so the seat
 * it names holds a person already typed.
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
 * and a new school at once — the shape `bewerbung_submission_subject_unresolved` refuses.
 */
export function bewerbungPayload(draft: BewerbungFormDraft) {
  const neu = istNeueSchule(draft.auswahl);

  return {
    saison_id: draft.saison_id,
    team_id: neu ? null : draft.auswahl,
    schule: neu ? draft.schule : null,
    // Mirrored on the way OUT rather than into state: the seat the claim names stays the one place
    // the person is edited, so nothing can drift between the two copies.
    kontakte: mirrorBewerbungTrainer(draft.kontakte),
    trikot: draft.trikot,
    kader: draft.kader,
    stufengroesse: draft.stufengroesse,
    // Judged on the TRIMMED value and sent untrimmed, as every other name here is: the backend
    // strips before it stores, and „   “ is no more a wish than `""`. `null` is the one spelling of
    // „kein Wunsch“ the product writes.
    wunschgegner: draft.wunschgegner.trim() === "" ? null : draft.wunschgegner,
  };
}

/**
 * The paths one judgement covers. While the claim stands, the Trainer seat holds the named seat's
 * person, so judging that seat's field alone leaves the copy's verdict over a value it never saw.
 */
export function bewerbungJudgedPaths(paths: readonly string[], mirroredSeat: FLTrainerAlso | null): readonly string[] {
  if (mirroredSeat === null) return paths;

  const copies = paths
    .filter((path) => path.startsWith(`kontakte.${mirroredSeat}.`))
    .map((path) => path.replace(`kontakte.${mirroredSeat}.`, "kontakte.trainer."));

  return copies.length === 0 ? paths : [...paths, ...copies];
}
