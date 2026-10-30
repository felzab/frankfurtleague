import { KONTAKT_EMAIL } from "@/core/brand";
import { isRecordMissing } from "@/core/errors";
import { medienNochNicht } from "@/features/bewerbungen/utils";
import { nummerPayload } from "@/features/spieler/utils";
import { isRefusal, isRuleRefusal, refusedPayloadAnswer } from "@/shared/utils/actionError";
import { buildRefusal, LADE_DIE_SEITE_NEU } from "@/shared/utils/refusal";
import { ANTWORT_NEU_OEFFNEN, FASSUNG_NEU_OEFFNEN, REGISTRIERUNG_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import { alterAusserhalb, REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE } from "./constants";

import type {
  FLEinladungAnsichtResponse,
  FLPostRegistrierungPayload,
  FLRegistrierung,
  FLRegistrierungBestaetigungPayload,
} from "@/core/generated/client/types";
import type { NamedTeam } from "@/features/bewerbungen/types";
import type { FieldErrors } from "@/shared/utils/validation";
import type { AdminRegistrierungRow, RegistrierungFormDraft, SpielerLinkZustand } from "./types";

/**
 * Which state the invite puts the registration page in.
 *
 * A link pasted after the window closed has to read „geschlossen“, or its holder goes away
 * believing an administrator revoked it. `laeuft` is the server's whole judgement.
 */
export function einladungZustand(ansicht: FLEinladungAnsichtResponse): "gueltig" | "geschlossen" {
  return ansicht.laeuft ? "gueltig" : "geschlossen";
}

/**
 * Which verdict of the read closes the form, in the order a reader can act on.
 *
 * A shut window outranks the rest; a missing team is the team's own to repair; a full squad reopens
 * when a place falls free.
 */
export function formularZustand(ansicht: FLEinladungAnsichtResponse): "gueltig" | "geschlossen" | "team-fehlt" | "kader-voll" {
  if (!ansicht.laeuft) return "geschlossen";
  if (!ansicht.team_eingetragen) return "team-fehlt";

  return ansicht.kader_frei ? "gueltig" : "kader-voll";
}

/**
 * The draft as the submission spells it.
 *
 * Every optional field is nulled here rather than per keystroke: `""` is a box nobody filled in, and
 * normalising as it is typed would eat a digit the moment it was deleted.
 */
export function registrierungPayload(draft: RegistrierungFormDraft, token: string): FLPostRegistrierungPayload {
  return {
    token: token,
    vorname: draft.vorname,
    nachname: draft.nachname,
    email: draft.email,
    position: draft.position,
    nummer: nummerPayload(draft.nummer),
    stufe: draft.stufe,
  };
}

/**
 * A submission refusal as what the form should show, or `null` where the code is none of these.
 *
 * A refusal naming a field takes that field's own path, so it lands under the control at fault.
 */
export function mapRegistrierungSubmitRefusal(
  error: unknown,
): { error?: string; fieldErrors?: FieldErrors; unplacedError?: string; zustand?: "ungueltig"; schonAngekommen?: true } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // Every body rule the form can break is mirrored, so a refusal no box can take is of a drifted
    // client, which the team's link replaces.
    case "REQ-VAL-002":
    case "REQ-VAL-001":
      return refusedPayloadAnswer(error, REGISTRIERUNG_NEU_OEFFNEN);
    // The link died between the page loading and this press, and the whole page is the answer: a
    // banner over a form nothing accepts invites a second attempt.
    case "REQ-EINLADUNG-003":
    // With the record missing, the season or the club the link names is gone: as dead a link.
    case "DB-COMMON-001":
      return { zustand: "ungueltig" };
    // Each reachable only where the season moved after this page loaded, and the team's link reopens
    // onto a page read since: the window's or the team's own panel, or the Stufen offered now.
    case "REQ-REGISTRIERUNG-001":
    case "REQ-REGISTRIERUNG-002":
    case "REQ-REGISTRIERUNG-003":
      return { error: REGISTRIERUNG_NEU_OEFFNEN };
    case "REQ-REGISTRIERUNG-008":
      return {
        error: buildRefusal({
          reason: "Der Kader dieses Teams ist voll",
          repair: "Wende Dich an Dein Team, wenn Du trotzdem mitspielen sollst",
        }),
      };
    // The press this form repeated stands, under the details first sent: a banner rather than a
    // field, since whichever box changed since then is not the one at fault.
    case "REQ-REGISTRIERUNG-011":
      return {
        schonAngekommen: true,
        error: buildRefusal({
          reason: "Deine Registrierung ist schon angekommen, mit den Angaben, die Du zuerst abgeschickt hast",
          repair: `Soll sich daran etwas ändern, schreib uns an ${KONTAKT_EMAIL}`,
        }),
      };
    // The same press, replayed after the team admitted it: the key outlives the registration on the
    // squad row, so the answer is the admission rather than a second registration.
    case "REQ-REGISTRIERUNG-016":
      return {
        schonAngekommen: true,
        error: buildRefusal({
          reason: "Deine Registrierung ist schon angekommen, und Dein Team hat Dich aufgenommen",
          repair: `Soll sich daran etwas ändern, schreib uns an ${KONTAKT_EMAIL}`,
        }),
      };
    // Neutral, and under the address it was judged on: a stranger learns nothing about a list, and
    // the person it does concern already knows why.
    case "REQ-REGISTRIERUNG-009":
      return {
        fieldErrors: {
          email: `Mit dieser E-Mail-Adresse ist keine Registrierung möglich. Wenn Du das für einen Fehler hältst, schreib uns an ${KONTAKT_EMAIL}.`,
        },
      };
    default:
      return null;
  }
}

/**
 * What a pupil is told where the provider refused their confirmation mail outright.
 *
 * It names a second attempt because the write refuses nothing on the strength of a pending row:
 * registering again mints a fresh link.
 */
const MAIL_ABGEWIESEN =
  "An diese Adresse konnten wir keine E-Mail schicken. Prüfe sie und registriere Dich über denselben Link erneut. " +
  `Der Eintrag von eben löscht sich nach ${String(REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE)} Tagen von selbst.`;

/** The refused send as the form shows it. */
export function abgewiesenerVersand(): { error?: string; fieldErrors?: FieldErrors } {
  return { fieldErrors: { email: MAIL_ABGEWIESEN } };
}

/** `alterAusserhalb` where the link's view serves no floor to name: both bounds, never a number of its own. */
const ALTER_AUSSERHALB_UNGELESEN = "Mit diesem Geburtsdatum bist Du zu jung oder zu alt.";

/**
 * The returning pupil's age refusal, judged on the date the league holds rather than one typed here: the page
 * has no field to correct, and every reopened link takes the same date, so the league is the repair.
 */
const GESPEICHERTES_GEBURTSDATUM_AUSSERHALB = buildRefusal({
  reason: "Dein bei uns gespeichertes Geburtsdatum liegt außerhalb der Altersgrenzen dieser Saison",
  repair: `Du siehst es in Deinem Konto. Stimmt es nicht, schreib uns an ${KONTAKT_EMAIL}`,
});

/** The returning pupil's page meeting a person the league holds no birthdate for: the page has no field, so the league is the repair. */
const GESPEICHERTES_GEBURTSDATUM_FEHLT = buildRefusal({
  reason: "Zu Deinem Eintrag haben wir kein Geburtsdatum gespeichert, deshalb können wir Deine Registrierung hier nicht bestätigen",
  repair: `Schreib uns an ${KONTAKT_EMAIL}, damit wir es eintragen`,
});

/** What one refused confirmation asks its caller to do. */
export type BestaetigungRefusal = { error?: string; fieldErrors?: FieldErrors; unplacedError?: string; zustand?: SpielerLinkZustand };

/** The link's own view, read again after a refused press: its floors where it is open, its state where not. A failed read is `null` beside it. */
export type GelesenerLink =
  | { readonly zustand: "gueltig"; readonly ansicht: { readonly mindestalter: number; readonly medien_mindestalter: number } }
  | { readonly zustand: SpielerLinkZustand };

// A THUNK and never a resolved read: the codes naming one state alone answer without it, and a caller
// reading the view in front of the switch spends a second backend read on each of them.
/**
 * A confirmation refusal as what the page should show, or `null` where the code is none of these.
 *
 * The floors are the token's own view's: a number of this mapper's own would state one the
 * endpoint is not using.
 */
export async function mapBestaetigungRefusal(
  error: unknown,
  gesendet: Pick<FLRegistrierungBestaetigungPayload, "geburtsdatum">,
  gelesen: () => Promise<GelesenerLink | null>,
): Promise<BestaetigungRefusal | null> {
  if (!isRefusal(error)) return null;

  const ansicht = async () => {
    const link = await gelesen();
    return link?.zustand === "gueltig" ? link.ansicht : null;
  };
  // The panel a reload opens on, which the press's own panel stands in for where the read finds the link open or reads nothing.
  const stand = async (sonst: SpielerLinkZustand): Promise<SpielerLinkZustand> => {
    const link = await gelesen();
    return link === null || link.zustand === "gueltig" ? sonst : link.zustand;
  };

  switch (error.serverErrorCode) {
    // The body shape is mirrored, so a refusal no box can take is of a drifted client, which the
    // mail's link replaces.
    case "REQ-VAL-002":
    case "REQ-VAL-001":
      return refusedPayloadAnswer(error, ANTWORT_NEU_OEFFNEN);
    // The switch is offered from the served age on the browser's day, so a clock disagreeing with the
    // backend's sends this, which a reopened link would offer again: switching it off is the repair.
    case "REQ-REGISTRIERUNG-010":
      return { error: medienNochNicht((await ansicht())?.medien_mindestalter ?? null) };
    // Answers the page did not ask: a drifted client, the label check refusing a page whose person
    // changed since it opened first. The mail's link reopens it.
    case "REQ-REGISTRIERUNG-017":
      return { error: ANTWORT_NEU_OEFFNEN };
    // Never the mail's link: every reopening takes the same undated person.
    case "REQ-REGISTRIERUNG-019":
      return { error: GESPEICHERTES_GEBURTSDATUM_FEHLT };
    // The backend's judgement of the label: a page opened before a
    // deploy moved it posts words other than those the backend runs, and only the mail's link reopens it.
    case "REQ-EINWILLIGUNG-001":
      return { error: FASSUNG_NEU_OEFFNEN };
    case "REQ-REGISTRIERUNG-004":
      return { zustand: "ungueltig" };
    // Judged ahead of a confirmation and of the ban, which the view ranks first: a link confirmed in another window,
    // or an address barred since, reads as a reload shows it.
    case "REQ-REGISTRIERUNG-005":
      return { zustand: await stand("abgelaufen") };
    // Judged ahead of the ban, which the view ranks first.
    case "REQ-REGISTRIERUNG-006":
      return { zustand: await stand("bestaetigt") };
    // The panel the view opens a barred link on, so a ban entered while the form stood open leaves no form either.
    case "REQ-REGISTRIERUNG-012":
      return { zustand: "gesperrt" };
    // The one refusal that spends no token, so a typed date's refusal lands on its field and the date survives it;
    // a `zustand` here would swap a live form for a dead-link panel.
    case "REQ-REGISTRIERUNG-007": {
      // No date sent is the returning pupil's stored one judged: their page asks none (`REQ-REGISTRIERUNG-017`).
      if (gesendet.geburtsdatum === null) return { error: GESPEICHERTES_GEBURTSDATUM_AUSSERHALB };

      const floor = (await ansicht())?.mindestalter ?? null;

      // A view that went unread names no floor: one guessed could send the person to correct a date that was right.
      return { fieldErrors: { geburtsdatum: floor === null ? ALTER_AUSSERHALB_UNGELESEN : alterAusserhalb(floor) } };
    }
    default:
      return null;
  }
}

/**
 * The administrator's list as its view receives it. Field by field and never a spread of the row: the
 * served row carries the pupil's address and birthdate, and a field the backend adds would ride
 * along to the browser unseen.
 */
export function buildAdminRegistrierungRows(registrierungen: readonly FLRegistrierung[], teams: readonly NamedTeam[]): AdminRegistrierungRow[] {
  const teamNamen = new Map(teams.map((team) => [team.id, team.name]));

  return registrierungen.map((registrierung) => ({
    id: registrierung.id,
    vorname: registrierung.vorname,
    nachname: registrierung.nachname,
    eingereicht_am: registrierung.eingereicht_am,
    team_id: registrierung.team_id,
    teamName: teamNamen.get(registrierung.team_id) ?? null,
    saison_id: registrierung.saison_id,
    stufe: registrierung.stufe,
    bestaetigt: registrierung.bestaetigt,
  }));
}

/** The registrations page with nothing pending: a decided queue and one nobody joined read alike. */
export const REGISTRIERUNGEN_LEER = "Keine offenen Registrierungen.";

/** Why an unconfirmed row offers no admission: its address is unverified until the pupil's own link is followed. */
export const NOCH_NICHT_BESTAETIGT = "Aufnehmen kannst Du erst, wenn die Person ihren Link bestätigt hat.";

/**
 * The same-person question. It names the stored person and never the differing values: the stored
 * birthdate was promised to the administrators alone.
 */
export const ANGABEN_WEICHEN_AB = "Die Angaben weichen von einem früheren Eintrag ab.";
export const dieselbePerson = (name: string): string => `Ist das dieselbe Person wie ${name}?`;

/** A registration another seat decided since the page was drawn: the press meets no pending row. */
export const REGISTRIERUNG_SCHON_ENTSCHIEDEN = buildRefusal({
  reason: "Diese Registrierung ist schon entschieden",
  repair: LADE_DIE_SEITE_NEU,
});

/**
 * A refused admission as the registrations page words it to a seat holder, or `null` for a code the
 * person spine answers. **The ban's refusal is neutral**: a team is never told that a pupil's address is barred.
 */
export function mapAufnahmeRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "DB-COMMON-001":
      return REGISTRIERUNG_SCHON_ENTSCHIEDEN;
    // The list marks the row and offers no press, so only a page older than the pupil's state sends this.
    case "REQ-REGISTRIERUNG-013":
      return buildRefusal({
        reason: "Diese Registrierung ist noch nicht bestätigt",
        repair: "Nimm sie auf, sobald die Person ihren Link bestätigt hat",
      });
    case "REQ-REGISTRIERUNG-009":
      return buildRefusal({ reason: "Diese Registrierung kann nicht aufgenommen werden", repair: "Wende Dich an die Liga" });
    case "REQ-REGISTRIERUNG-003":
      return buildRefusal({
        reason: "Diese Stufe ist in dieser Saison nicht zugelassen",
        repair: "Lehne die Registrierung ab oder wende Dich an die Liga",
      });
    // The page sends exactly the person the read resolved, so this is a page older than
    // the stored person it names.
    case "REQ-REGISTRIERUNG-014":
      return buildRefusal({
        reason: "Wen diese Registrierung meint, hat sich seit dem Laden der Seite geändert",
        repair: "Lade die Seite neu und entscheide erneut",
      });
    // The pupil confirmed as a person the league has erased since, and gave no answers a new person
    // could stand on: only a fresh registration asks them.
    case "REQ-REGISTRIERUNG-018":
      return buildRefusal({
        reason: "Die Person zu dieser Registrierung ist bei uns nicht mehr gespeichert",
        repair: "Lehne die Registrierung ab. Die Person kann sich danach erneut registrieren",
      });
    case "REQ-REGISTRIERUNG-015":
      return buildRefusal({
        reason: "Diese Person steht in dieser Saison schon in einem Kader",
        repair: "Lehne die Registrierung ab oder wende Dich an die Liga",
      });
    // The administrator's remedy, raising the cap, is no seat holder's: the league is.
    case "REQ-SQUAD-003":
      return buildRefusal({
        reason: "Der Kader Deines Teams ist für diese Saison voll",
        repair: "Wende Dich an die Liga, wenn noch jemand dazukommen soll",
      });
    default:
      return null;
  }
}

/** A refused decline as the registrations page words it, or `null` for a code the person spine answers. */
export function mapAblehnungRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  return error.serverErrorCode === "DB-COMMON-001" ? REGISTRIERUNG_SCHON_ENTSCHIEDEN : null;
}

/**
 * A refused read as the panel it renders, or `null` where the read failed instead.
 *
 * Every rule's refusal alike: a spent link answers its own state in a 200, so a refusal is a token
 * nothing could place.
 */
export function mapRegistrierungAnsichtRefusal(error: unknown): "ungueltig" | null {
  if (!isRefusal(error)) return null;

  // A token the backend will not parse matches no record, so the page calls the link void rather
  // than offering a reload that cannot succeed.
  if (error.serverErrorCode === "REQ-VAL-001") return "ungueltig";

  // The season or club an invitation names gone, which the invitation's read answers as the sign-up
  // does; the confirmation's read and write meet no gone record.
  if (isRecordMissing(error)) return "ungueltig";

  return isRuleRefusal(error) ? "ungueltig" : null;
}
