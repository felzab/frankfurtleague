import { parseDate } from "@internationalized/date";

import { KONTAKT_EMAIL } from "@/core/brand";
import { medienZuJung } from "@/features/konto/einwilligung";
import { isRefusal, isRuleRefusal, refusedPayloadAnswer } from "@/shared/utils/actionError";
import { buildRefusal, LADE_DIE_SEITE_NEU, LADE_NEU_UND_VERSUCHE_ES_ERNEUT } from "@/shared/utils/refusal";
import { ANTWORT_NEU_OEFFNEN, FASSUNG_NEU_OEFFNEN } from "@/shared/utils/reopenLink";
import { mirrorTrainerSeat } from "@/shared/utils/trainerSeat";

import { alterAusserhalb, BEWERBUNG_MAX_ALTER, KUERZEL_LAENGE, SCHULE_NICHT_IN_LISTE } from "./constants";

import type {
  FLBewerbung,
  FLBewerbungEinwilligungAnsichtResponse,
  FLBewerbungFensterResponse,
  FLTrainerZugleich,
} from "@/core/generated/client/types";
import type { FieldErrors } from "@/shared/utils/validation";
import type { BewerbungHerkunft } from "./constants";
import type {
  AdminBewerbungRow,
  BewerbungFormDraft,
  BewerbungKontakteDraft,
  BewerbungKontaktpersonDraft,
  BewerbungSchuleDraft,
  EinwilligungAnsicht,
  FensterZustand,
  KuerzelVerdikt,
  LinkZustand,
  NamedTeam,
} from "./types";

/**
 * The ONE answer a taken Kürzel gets, wherever it is judged. It names no club and does not say
 * whether that club still plays.
 */
export const KUERZEL_VERGEBEN = "Dieses Kürzel ist schon vergeben.";

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
  // A verdict about another value says nothing about this one.
  if (verdikt === null || verdikt.shorthand !== shorthand) return KUERZEL_UNGEPRUEFT;

  return verdikt.vergeben ? null : KUERZEL_FREI;
}

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
 * (`fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungEinwilligungAnsichtResponse`).
 */
export function geburtsdatumSpanne(today: string, mindestalter: number): { frueheste: string; spaeteste: string } {
  const heute = parseDate(today);

  // The day AFTER one year past the ceiling: `fl_backend/app/shared/alter.py :: whole_years_between`
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
    case "bewerbung_fenster_geschlossen":
      return {
        error: buildRefusal({
          reason: "Für diese Saison werden gerade keine Bewerbungen angenommen",
          repair: LADE_DIE_SEITE_NEU,
        }),
      };
    case "bewerbung_submission_subject_unresolved":
      return { fieldErrors: { team_id: "Wähle entweder eine bestehende Schule aus oder trage eine neue ein, nicht beides." } };
    // Reload-and-pick leads: this is reachable only for an id the picker never offered. The new-school
    // arm names a free Kürzel so nobody walks into `bewerbung_shorthand_taken`, and says nothing about why the club went,
    // which is what `READ-BEWERBUNG-001` asks of it.
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
    case "bewerbung_shorthand_taken":
      return { fieldErrors: { "schule.shorthand": KUERZEL_VERGEBEN } };
    // The press this form repeated stands, under the details first sent: a banner rather than a
    // field, since whichever box changed since then is not the one at fault.
    case "bewerbung_schluessel_abweichend":
      return {
        schonAngekommen: true,
        error: buildRefusal({
          reason: "Deine Bewerbung ist schon angekommen, mit den Angaben, die Du zuerst abgeschickt hast",
          repair: `Soll sich daran etwas ändern, schreib uns an ${KONTAKT_EMAIL}`,
        }),
      };
    // A banner naming no seat, as a 403 carries no field, and neutral as the registration's is: a
    // stranger learns nothing about a list, and the person it concerns already knows why.
    case "bewerbung_adresse_gesperrt":
      return {
        error: buildRefusal({
          reason: "Mit einer der angegebenen E-Mail-Adressen ist keine Bewerbung möglich",
          repair: `Wenn Du das für einen Fehler hältst, schreib uns an ${KONTAKT_EMAIL}`,
        }),
      };
    // With the record missing, the season this page names is one the running API does not hold: only a
    // page from before a data reset, or a crafted body, sends it, and the reload fetches the window open now.
    case "document_not_found":
    // A seat names words other than the form's, which only a page loaded before a deploy sends.
    case "fassung_unzulaessig":
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

/** The contact page's age refusal where the link's view serves no floor to name: both bounds, as `alterAusserhalb` names them. */
const GEBURTSDATUM_AUSSERHALB = "Mit diesem Geburtsdatum bist Du für Deine Bestätigung zu jung oder zu alt.";

/** What one refused confirmation shows: a sentence, a field's message, or the panel the link opens on. */
export type EinwilligungRefusal = {
  error?: string;
  fieldErrors?: FieldErrors;
  unplacedError?: string;
  zustand?: LinkZustand | "saison_vorbei";
  /** The view a closed season's page names its cause from, as the read after the refusal answered it. */
  ansicht?: FLBewerbungEinwilligungAnsichtResponse;
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
    return link?.zustand === "gueltig" ? link.ansicht : null;
  };
  // The panel a reload opens on, which the press's own panel stands in for where the read finds the link open or reads nothing.
  const stand = async (sonst: LinkZustand | "saison_vorbei"): Promise<EinwilligungRefusal> => {
    const link = await gelesen();
    if (link === null || link.zustand === "gueltig") return { zustand: sonst };

    // With the read it came from: the page's own read predates the press, and names a team that left since as a
    // season that ended.
    return link.zustand === "saison_vorbei" ? { zustand: link.zustand, ansicht: link.ansicht } : { zustand: link.zustand };
  };

  switch (error.serverErrorCode) {
    // The body shape is mirrored, so a refusal no box can take is of a drifted client, which the
    // mail's link replaces.
    case "body_unreadable":
    case "payload_refused":
      return refusedPayloadAnswer(error, ANTWORT_NEU_OEFFNEN);
    // The backend's judgement of the label: a page opened before a
    // deploy moved it posts words other than those the backend runs, and only the mail's link reopens it.
    case "fassung_unzulaessig":
      return { error: FASSUNG_NEU_OEFFNEN };
    case "link_ungueltig":
      return { zustand: "ungueltig" };
    // Judged ahead of the seat and the ban, which the view ranks first: an answer given in another window, or a ban
    // entered since, reads as the view says, and the spent link's panel stands for the rest.
    case "link_abgelaufen":
    case "bewerbung_token_past_deadline":
      return stand("abgelaufen");
    // A season row's link whose season ended or whose team left, which still takes a Widerspruch, unless the ban the
    // press judges after it bars the address: the view's page either way.
    case "kontakt_saison_vorbei":
      return stand("saison_vorbei");
    // One code covers both answers, so „bestätigt“ here would tell a seat declined in another window
    // that it confirmed. Which way it went is the read's to say.
    case "bewerbung_sitz_already_answered":
      return stand("ungueltig");
    // The one refusal that spends no token, so it lands on the field and the typed date survives it;
    // a `zustand` here would swap a live form for a dead-link panel. A view that went unread names no floor.
    case "bestaetigung_alter": {
      const floor = (await ansicht())?.mindestalter ?? null;
      return { fieldErrors: { geburtsdatum: floor === null ? GEBURTSDATUM_AUSSERHALB : alterAusserhalb(floor) } };
    }
    // Spends nothing either, and the typed date survives it; a toast, the switch rendering no error of its own.
    // The floor is the view's as the age refusal's is, so a view that went unread names none.
    case "medien_alter":
      return { error: medienNochNicht((await ansicht())?.medien_mindestalter ?? null) };
    // The panel the view opens a barred link on, so a ban entered while the form stood open leaves no
    // form either: the page offers no Widerspruch to a barred address.
    case "link_gesperrt":
      return { zustand: "gesperrt" };
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
  if (error.serverErrorCode === "payload_refused") return "ungueltig";

  // Every rule's refusal alike: a spent link answers its own `zustand` in a 200, so a refusal is a
  // token nothing could place, and a code nobody planned reads the same way.
  return isRuleRefusal(error) ? "ungueltig" : null;
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
  // Ahead of every date answer: an ended season takes no application again, so „gerade geschlossen“
  // or „noch nicht offen“ would send a school to wait for a window that never reopens.
  if (fenster.saison_beendet) return "vorbei";
  // Before either date: the league closed it, which is not the same as a deadline passing.
  if (!fenster.offen) return "geschlossen";
  if (today < fenster.von) return "noch-nicht";

  // Never `vorbei` by default: `laeuft` is false with the span still open where this clock and the
  // server's disagree, and "abgelaufen" would name a deadline nobody reached.
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

const buildEmptyBewerbungKontaktperson = (textVersion: string): BewerbungKontaktpersonDraft => ({
  vorname: "",
  nachname: "",
  email: "",
  telefon: "",
  // Stamped as the form opens, so what a record cites is the wording its reader was shown.
  einwilligung: { text_version: textVersion, erteilt: false },
});

/** A blank new school, held from the moment the form opens so nothing typed into it can be dropped. */
const buildEmptyBewerbungSchule = (): BewerbungSchuleDraft => ({
  team_name: "",
  full_name: "",
  shorthand: "",
  schulform: null,
  address: { strasse: "", hausnummer: "", plz: "", stadtteil: "", stadt: "" },
  // `null` and not `""`: the box starts empty either way, and this is the one spelling of "no
  // website" the product writes, so a submission never carries two of them.
  website_url: null,
});

export const buildEmptyBewerbungDraft = (saisonId: string, textVersion: string): BewerbungFormDraft => ({
  saison_id: saisonId,
  auswahl: null,
  schule: buildEmptyBewerbungSchule(),
  kontakte: {
    trainer: buildEmptyBewerbungKontaktperson(textVersion),
    ansprechperson: buildEmptyBewerbungKontaktperson(textVersion),
    stellvertretung: buildEmptyBewerbungKontaktperson(textVersion),
    trainer_ist_zugleich: null,
  },
  trikot: { vorhandener_satz: "", wunschfarbe: null },
  kader: { voraussichtliche_groesse: null, gute_spieler: null },
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
export function bewerbungJudgedPaths(paths: readonly string[], mirroredSeat: FLTrainerZugleich | null): readonly string[] {
  if (mirroredSeat === null) return paths;

  const copies = paths
    .filter((path) => path.startsWith(`kontakte.${mirroredSeat}.`))
    .map((path) => path.replace(`kontakte.${mirroredSeat}.`, "kontakte.trainer."));

  return copies.length === 0 ? paths : [...paths, ...copies];
}
