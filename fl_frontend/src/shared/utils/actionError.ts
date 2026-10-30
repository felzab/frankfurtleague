// Redesign: goes with its last importer.
import { isEdgeRefusal } from "@/kit/edgeRefusal";

import { APIBadStatusError, APINetworkError, isRecordMissing, isRefusalCode, mayHaveWritten, RolledBackError } from "@/core/errors";

import { buildRefusal, LADE_DIE_SEITE_NEU, UNKNOWN_REFUSAL, VERSUCHE_ES_ERNEUT_SATZ } from "./refusal";
import { toFieldErrors, VALIDATION_FAILED } from "./validation";

import type { SentRequest } from "@/core/errors";
import type { Code } from "@/core/generated/client/types";
import type { ActionFailure } from "@/shared/types/types";
import type { ZodError } from "zod";
import type { FieldErrors } from "./validation";

/**
 * What every spine's guard answers a session that drew the page and fails it by the press: lapsed, ended, or an
 * administrator's made before a grant issued since. A sign-in repairs each, so one sentence, never naming a missing role.
 */
export const ANMELDUNG_ABGELAUFEN = "Deine Anmeldung ist abgelaufen. Melde Dich neu an.";

/**
 * What an administrator whose grant is gone is told, by the guard, by the backend's actor check and by the
 * grant's own refusal: neither a retry nor a new sign-in restores it.
 */
export const ZUGANG_WEG = "Dein Zugang zur Verwaltung besteht nicht mehr.";

/**
 * What a person whose address was barred after their session was judged is told: the ban outlasts a
 * retry and a sign-in alike, so neither is offered.
 */
const GESPERRT_KEINE_AENDERUNG = "Diese E-Mail-Adresse ist gesperrt. Solange die Sperre gilt, ist keine Änderung möglich.";

/**
 * What a seat holder whose seat went after the page was drawn is told, by the person spine and by the
 * backend's own seat check: a reload draws the page they still hold, or the forbidden panel.
 */
export const SITZ_WEG = "Du bist in dieser Saison nicht mehr in diesem Team eingetragen. Lade die Seite neu.";

/**
 * Under a box whose value only the API refused. Never the form's own message for that box: the form's
 * rules passed the value, so each of those describes a rule it already met.
 */
export const FELD_ABGELEHNT = "Diese Angabe wurde so nicht übernommen.";

/** The unique index's refusal (`duplicate_key`): the conflict is the same one whichever write met it. */
const KONFLIKT_MIT_BESTEHENDEM = "Der Eintrag steht im Konflikt mit einem, den es schon gibt.";

/**
 * An admin editor's answer to a `payload_refused` no rendered control takes, which only a page older than
 * the running API can send: a retry resends the refused body, and a reload fetches the page that fits.
 */
const EINZELNE_ANGABEN_ABGELEHNT = buildRefusal({ reason: "Einzelne Angaben wurden nicht übernommen", repair: LADE_DIE_SEITE_NEU });

/**
 * Whether the API refused the request, which every mapper asks before reading the code: a 4xx, at
 * whatever status the code's rule answers with. Never a 5xx, after which a write may have landed.
 */
export function isRefusal(error: unknown): error is APIBadStatusError {
  return error instanceof APIBadStatusError && error.statusCode >= 400 && error.statusCode < 500;
}

/**
 * Whether the backend found the Funktion the request acts in not held (`funktion_nicht_gehalten`): a write
 * answers it with `SITZ_WEG`, and a page reading for that seat renders the forbidden panel.
 */
export function isFunktionLost(error: unknown): error is APIBadStatusError {
  return isRefusal(error) && error.serverErrorCode === "funktion_nicht_gehalten";
}

/**
 * Whether one of the API's rules refused the request, by the code's class
 * (`fl_frontend/src/core/errors.ts :: isRefusalCode`): a code no arm names reaches its kind's fallback
 * at any status, and a protocol code, a routing one included, never does.
 */
export function isRuleRefusal(error: unknown): error is APIBadStatusError {
  return isRefusal(error) && isRefusalCode(error.serverErrorCode);
}

/**
 * The body fields a refusal names, a `payload_refused`'s or a rule's, keyed as the inputs are named, or `null`
 * where it names none. A form showing nothing under any of them is `useServerFieldErrors`'s to announce.
 */
function refusedFieldErrors(error: APIBadStatusError): FieldErrors | null {
  const fieldErrors: FieldErrors = {};
  for (const field of error.refusedFields) {
    // A query or header value belongs to no control, and an empty path is the body as a whole.
    if (field.in !== "body" || field.path.length === 0) continue;

    fieldErrors[field.path.join(".")] = FELD_ABGELEHNT;
  }

  return Object.keys(fieldErrors).length === 0 ? null : fieldErrors;
}

/**
 * Where no rendered box takes the refusal, the slice's own sentence stands and never
 * `UNHANDLED_FIELD_REFUSAL`, whose retry resends the body just refused.
 */
export function refusedPayloadAnswer(error: APIBadStatusError, sentence: string): RefusedAnswer {
  return answerBeside(refusedFieldErrors(error), sentence);
}

/**
 * A public route's own parse refusing the body, answered as the API's refusal of it is: the parse
 * shares the running API's rules, so a path it names and no control renders comes from an older page.
 */
export function refusedDraftAnswer(error: ZodError, sentence: string): RefusedAnswer {
  const fieldErrors = toFieldErrors(error);

  return answerBeside(Object.keys(fieldErrors).length === 0 ? null : fieldErrors, sentence);
}

type RefusedAnswer = { error: string } | { fieldErrors: FieldErrors; unplacedError: string };

function answerBeside(fieldErrors: FieldErrors | null, sentence: string): RefusedAnswer {
  return fieldErrors === null ? { error: sentence } : { fieldErrors, unplacedError: sentence };
}

/** A refusal no mapper words, as the failure a form renders: its named boxes marked, `sentence` for the rest. */
export function refusedFailure(error: APIBadStatusError, sentence: string): ActionFailure {
  const fieldErrors = refusedFieldErrors(error);

  return fieldErrors === null
    ? { success: false, error: sentence }
    : { success: false, error: VALIDATION_FAILED, fieldErrors, unplacedError: sentence };
}

/**
 * The Spiel refusals `fl_frontend/src/features/spiele/refusals.ts :: mapSpielRefusal` does not map.
 * Three name an OCCUPANT, which the form places at fault; the two `state_*` codes name none, so
 * their code rides back unused and the message lands as a toast.
 */
const OCCUPANT_REFUSALS: Readonly<Partial<Record<Code, string>>> = {
  // Three triggers: a re-dating or a changed Sonderereignis fires the rule as a new club does. Its
  // remedies ride the match editor's rail, from
  // `fl_frontend/src/features/spiele/components/forms/AdminEditSpielDataForm/banners.ts`.
  eligibility_disqualified: "Dieses Team ist aus der Saison ausgeschieden und darf ab seinem Austritt nicht mehr aufgestellt sein.",

  eligibility_team_not_in_saison: "Dieses Team nimmt nicht an dieser Saison teil.",
  state_ergebnis_on_a_non_event: "Ein Spiel mit diesem Sonderereignis wird nicht gewertet. Entferne zuerst die Tore.",
  state_nichtantreten_without_two_sides: "Ein Nichtantreten braucht beide Teams. Besetze zuerst den offenen Platz.",
  // The repair is on the OTHER fixture, so it rides the same rail rather than this field.
  spieltag_occupied: "Dieses Team spielt am selben Spieltag schon in einem anderen Spiel.",
};

/** The sentence of a write that may or may not have landed. */
export const SPEICHERUNG_UNKLAR = buildRefusal({
  reason: "Ob die Änderung gespeichert wurde, ist unklar",
  repair: "Lade die Seite neu und prüfe, ob sie da ist",
});

/** A write that may or may not have landed, marked so the toast titles it neither a success nor a failure. */
const OUTCOME_UNKNOWN: ActionFailure = { success: false, error: SPEICHERUNG_UNKLAR, outcome: "unknown" };

/**
 * A spine's answer where a write it sent may stand behind whatever the body made of it. Never an
 * action's rejection, which `unansweredAction` reads first.
 */
export function outcomeUnknown(): ActionFailure {
  return { ...OUTCOME_UNKNOWN };
}

/** A press the edge's rate refused, which never reached Next: nothing was written, and the meter refills within the minute. */
export const ZU_VIELE_VERSUCHE_NICHTS_GESPEICHERT =
  "Zu viele Versuche in kurzer Zeit. Die Änderung wurde nicht gespeichert. Warte einen Moment und versuche es dann erneut.";

/**
 * A send or a submission the edge's rate refused, under a title saying what did not happen: the meter
 * refills within the minute. The public forms' answer to the same refusal too.
 */
export const ZU_VIELE_VERSUCHE = "Zu viele Versuche in kurzer Zeit. Warte einen Moment und versuche es dann erneut.";

/**
 * A send's state where its action rejected with the edge's own refusal, which reached nothing past the
 * edge; any other rejection is handed back unread, to whatever its caller answers it with.
 */
export function edgeRefusedSend(error: unknown): ActionFailure | null {
  return isEdgeRefusal(error) ? { success: false, error: ZU_VIELE_VERSUCHE } : null;
}

/**
 * An editor's answer to its own action rejecting: the press may have reached the server, and uncaught in a
 * transition the rejection replaces the editor with the error page. Required: dropped, the edge's refusal reads
 * as an unclear save.
 */
export function unansweredAction(error: unknown, repair?: string): ActionFailure {
  // The one rejection that says what became of the press: the edge refused it before Next ran.
  if (isEdgeRefusal(error)) return { success: false, error: ZU_VIELE_VERSUCHE_NICHTS_GESPEICHERT };

  return repair === undefined ? { ...OUTCOME_UNKNOWN } : { ...OUTCOME_UNKNOWN, error: repair };
}

/**
 * A write action's rejection answered as `unansweredAction` answers it, with the page read again: a rejection brings
 * no server refresh back while the write may stand. The edge's refusal wrote nothing, so it reads nothing.
 */
export function rejectedWrite(router: { refresh: () => void }, repair?: string): (error: unknown) => ActionFailure {
  return (error) => {
    if (!isEdgeRefusal(error)) router.refresh();

    return unansweredAction(error, repair);
  };
}

/**
 * `rejectedWrite`'s repair on a control sending a confirmation link from a page its reload shows again. A rejection says
 * nothing of whether the link left, and a new link replaces the earlier one; the reload comes first.
 */
export const LINK_ERNEUT_OHNE_ANTWORT =
  "Prüfe die Verbindung, lade die Seite neu und sende den Link erneut. Ein neuer Link ersetzt einen, der schon rausging.";

/** The toast title of a link send whose outcome is unknown: a send saves nothing, so the title saves nothing either. */
export const LINK_UNKLAR = "Unklar, ob der Link verschickt wurde";

/**
 * An admin read's answer to its own action rejecting: it wrote nothing, so it is the failure it is,
 * never `unansweredAction`'s unclear save. One sentence for every read.
 */
export function unansweredRead(): ActionFailure {
  return { success: false, error: UNKNOWN_REFUSAL };
}

/** A refusal in the words its code is given here, or `null` for one no arm words and no rule made. */
function refusedAnswer(error: APIBadStatusError): ActionFailure | null {
  // A request the running API does not take, naming only a query parameter or the body whole, or
  // unreadable (`body_unreadable`): the page that fits it comes with a reload, where a retry resends it
  // unchanged.
  if (error.serverErrorCode === "payload_refused" || error.serverErrorCode === "body_unreadable") {
    return refusedFailure(error, EINZELNE_ANGABEN_ABGELEHNT);
  }

  if (error.serverErrorCode === "wiring_unsupported") {
    // The form does not offer these shapes, so the request was built against a season that has since moved.
    return { success: false, error: "Die Saison wurde inzwischen geändert. Lade die Seite neu." };
  }
  if (error.serverErrorCode === "wiring_seed_past_the_opening_round") {
    // NOT the reload above: the form offered this answer and a reload only closes it, so what the
    // admin wanted needs a different source rather than a fresh page.
    return {
      success: false,
      error: buildRefusal({
        reason:
          "Eine Seite dieses Spiels hat als Herkunft einen Platz in einer Gruppe, und das ist nur in der ersten KO-Runde der Saison möglich",
        repair: "Wähle für diese Seite stattdessen ein früheres Spiel als Herkunft, oder setze das Team manuell",
      }),
    };
  }
  if (error.serverErrorCode === "wiring_gruppe_not_run") {
    // The picker offers only the season's own groups, so this arriving means the season was
    // redrawn narrower under the open form: the offer itself is stale, and a reload renews it.
    return {
      success: false,
      error: buildRefusal({
        reason: "Als Herkunft ist ein Platz in einer Gruppe gewählt, die es in dieser Saison nicht gibt",
        repair: "Lade die Seite neu und wähle dann eine Gruppe dieser Saison",
      }),
    };
  }
  if (error.serverErrorCode !== undefined) {
    // The code is an unvalidated wire string, and an unguarded lookup reaches `Object.prototype`: `toString` selects a function.
    const occupantRefusal = Object.hasOwn(OCCUPANT_REFUSALS, error.serverErrorCode) ? OCCUPANT_REFUSALS[error.serverErrorCode] : undefined;
    if (occupantRefusal !== undefined) {
      // Unlike the stale-form refusal above, reloading fixes none of these. The code rides back out
      // so the form can put the message on the side that caused it.
      return { success: false, error: occupantRefusal, errorCode: error.serverErrorCode };
    }
  }
  if (error.serverErrorCode === "duplicate_key") {
    // The ordinary outcome of a create hitting a unique index, possibly a retired row keeping its slot.
    return { success: false, error: KONFLIKT_MIT_BESTEHENDEM };
  }
  if (isRuleRefusal(error)) {
    // Any other code is a rule no mapper here words, and naming the unique index for it would send the
    // admin looking for an entry that may not exist.
    return refusedFailure(error, UNKNOWN_REFUSAL);
  }

  return null;
}

/**
 * Maps whatever a mutation threw onto the refusal the admin forms render. Each message names the way out rather
 * than the failure: the diagnosis is in the server log, and the toast's title says what became of the save.
 */
export function toActionErrorResult(error: unknown, answering?: SentRequest): ActionFailure {
  if (error instanceof APIBadStatusError) {
    // Raised by the actor check before any handler, so nothing was written: the grant went after the guard read it.
    if (error.serverErrorCode === "actor_not_admin") return { success: false, error: ZUGANG_WEG };
    // The person binder reads the ban per request, so a ban entered since the session was judged.
    if (error.serverErrorCode === "person_barred") return { success: false, error: GESPERRT_KEINE_AENDERUNG };
  }
  // A rule's code, so ahead of the rule fallback below, which would name no reason for it.
  if (isFunktionLost(error)) return { success: false, error: SITZ_WEG };

  if (isRefusal(error)) {
    const refused = refusedAnswer(error);
    if (refused !== null) return refused;
    if (isRecordMissing(error)) return { success: false, error: "Der Eintrag wurde nicht gefunden. Lade die Seite neu." };
  }

  if (error instanceof APIBadStatusError) {
    if (error.statusCode === 500 && error.serverErrorCode === "unknown_outcome") {
      // A commit went unanswered, or the deadline cut a write, so the write may stand: "try again"
      // would repeat it, and the retry then meets its own "already exists".
      return outcomeUnknown();
    }
    // Only `database_failed` says the write failed: any other 5xx can follow a commit, an unhandled crash
    // or a proxy's own answer among them.
    if (error.statusCode >= 500 && error.serverErrorCode !== "database_failed" && mayHaveWritten(error)) return outcomeUnknown();

    return { success: false, error: `Der Server hat mit einem Fehler geantwortet. ${VERSUCHE_ES_ERNEUT_SATZ}` };
  }

  if (error instanceof APINetworkError) {
    // A write whose answer never arrived may have landed, which a retry would repeat: a connection
    // lost after the send is as silent as a timeout. A read changed nothing, and trying again repairs it.
    if (mayHaveWritten(error)) return outcomeUnknown();

    return {
      success: false,
      error: error.isTimeout
        ? `Der Server hat zu lange nicht geantwortet. ${VERSUCHE_ES_ERNEUT_SATZ}`
        : "Der Server ist gerade nicht erreichbar. Versuche es später erneut.",
    };
  }

  // This application's own throw carries no request, so the one its caller answers stands in: thrown
  // after a write, it leaves the row standing under a failure's title. A proven rollback wrote nothing.
  if (answering !== undefined && mayHaveWritten(answering) && !(error instanceof RolledBackError)) return outcomeUnknown();

  return { success: false, error: UNKNOWN_REFUSAL };
}
