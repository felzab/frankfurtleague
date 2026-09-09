"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { buildBewerbungAbsageEmail, buildBewerbungBestaetigungEmail, buildBewerbungZusageEmail } from "@/core/bewerbungEmail";
import { frontend_config } from "@/core/config";
import { APIBadStatusError } from "@/core/errors";
import { logger } from "@/core/logging";
import { trikotFarbeLabel } from "@/features/teams/constants";
import { getTeamMemberships } from "@/features/teams/queries";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { formatSpielDatum } from "@/shared/utils/format";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors } from "@/shared/utils/validation";

import { bestaetigungsLink } from "./bestaetigungLink";
import { gepaarteSitze } from "./bestaetigungStand";
import { ablehnenBewerbung, annehmenBewerbung, erneutSendenEinwilligung, korrigierenKontaktEmail } from "./mutations";
import { collectBewerbungEmpfaenger, describeBewerbungMail, rollenText, sendBewerbungMail } from "./notifications";
import { getBewerbungById } from "./queries";
import {
  FLAblehnenBewerbungPayloadSchema,
  FLAnnehmenBewerbungPayloadSchema,
  FLBewerbungKontaktEmailPayloadSchema,
  FLEinwilligungErneutPayloadSchema,
} from "./schemas";
import { bewerbungTeamName, describeAufnahme } from "./utils";

import type { BewerbungEmail } from "@/core/bewerbungEmail";
import type { KontaktRolle } from "@/features/teams/constants";
import type { ActionResult } from "@/shared/types/types";
import type { FieldErrors } from "@/shared/utils/validation";
import type { BewerbungBetreff } from "./notifications";
import type {
  FLAblehnenBewerbungPayload,
  FLAnnehmenBewerbungPayload,
  FLBewerbung,
  FLBewerbungKontaktEmailPayload,
  FLEinwilligungErneutPayload,
} from "./schemas";

/** Where a club is created and reactivated, named as the sidemenu entry reads. */
const TEAMS_PAGE = "Teams";

/**
 * A triage 409 as the message it should render, or `null` when the code is none of these.
 *
 * The `REQ-ENTER` codes are the season's own entry rules, which
 * `fl_backend/app/api/bewerbungen/admin_router.py` reuses rather than restates.
 */
function mapTriageRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  switch (error.serverErrorCode) {
    // One code for both endpoints: what is refused is deciding an application twice, and which press
    // arrived second is nothing an administrator can act on differently.
    case "REQ-BEWERBUNG-001":
      return {
        error: buildRefusal({
          reason: "Über diese Bewerbung ist schon entschieden worden, und eine Entscheidung wird einmal getroffen",
          repair: "Lade die Seite neu",
        }),
      };
    case "REQ-BEWERBUNG-002":
      return {
        error: buildRefusal({
          reason:
            "Diese Bewerbung nennt weder genau einen bestehenden Verein noch genau eine neue Schule, und damit steht nicht fest, wer aufgenommen würde",
          repair: { before: "Lehne sie ab und lege das Team", after: "selbst an" },
          where: TEAMS_PAGE,
        }),
      };
    // The application's own validator asserts no more than `docs/backend/spec.md :: I16`, while `teams`
    // reads a club through a stricter model, so a school's details can make no club. Nothing edits them.
    case "REQ-BEWERBUNG-003":
      return {
        error: buildRefusal({
          // The fields are named as `BewerbungAngabenPanel` labels them, so the administrator reading this finds
          // each one. Schulform is absent because the validator's enum keeps it out of this rule.
          reason:
            "Die Angaben dieser Schule ergeben kein gültiges Team: Team-Name, vollständiger Name, Kürzel, Adresse oder Website passen nicht in die Form, die ein Team haben muss",
          repair: { before: "Lehne die Bewerbung ab und lege das Team", after: "mit korrigierten Angaben selbst an" },
          where: TEAMS_PAGE,
        }),
      };
    // Reachable from a page that was open while a seat's state moved: the view closes the acceptance
    // while a seat is outstanding, so the reload is what puts the current state in front of the
    // administrator, seat by seat.
    case "REQ-BEWERBUNG-013":
      return {
        error: buildRefusal({
          reason: "Nicht jede Kontaktperson dieser Bewerbung hat ihren Eintrag bestätigt",
          repair: "Lade die Seite neu",
        }),
      };
    // `REQ-ENTER-001` to `-003` open with the sentence
    // `fl_frontend/src/features/teams/actions.ts :: mapEntryRefusal` renders too, so only the repair
    // below is this one's own; `fl_frontend/src/features/bewerbungen/actions.test.ts` holds the pairs equal.
    case "REQ-ENTER-001":
      return {
        error: buildRefusal({
          reason: "Diese Saison ist nicht mehr in Planung, und aufgenommen wird nur in eine geplante Saison",
          repair: "Lehne die Bewerbung ab",
        }),
      };
    // On the picker: the field at fault is the one the admin can move, and a message under the
    // control that is itself the way out carries no repair sentence (`docs/frontend/spec.md` §1.12).
    case "REQ-ENTER-002":
      return { fieldErrors: { gruppe: "Diese Gruppe gibt es in dieser Saison nicht." } };
    case "REQ-ENTER-003":
      return { fieldErrors: { gruppe: "Diese Gruppe ist schon voll." } };
    // A new school's club is created with the Kürzel the school typed, and a club's only unique key
    // is that Kürzel, so this 409 IS the collision. The generic conflict names no way out, and
    // nothing edits a school's details.
    case "DB-COMMON-002":
      return {
        error: buildRefusal({
          reason: "Das Kürzel dieser Schule hat schon ein anderes Team, vielleicht ein stillgelegtes",
          repair: { before: "Ändere das Kürzel des anderen Teams", after: "und nimm die Bewerbung danach an" },
          where: TEAMS_PAGE,
        }),
      };
    // „Stillgelegt“ is what every admin surface calls `inactive_since`, the club editor included.
    // „Verlassen“ is an `austritt`, another record on another page.
    case "REQ-ENTER-005":
      return {
        error: buildRefusal({
          reason: "Das Team dieser Bewerbung ist stillgelegt und kann in keine Saison aufgenommen werden",
          repair: { before: "Reaktiviere es", after: "und nimm die Bewerbung danach an" },
          where: TEAMS_PAGE,
        }),
      };
    default:
      return null;
  }
}

/**
 * The club the message to the school is addressed to. `null` where the application names neither a
 * school nor a club — a decline reaches that row, and nobody may guess a name for an outbound message.
 */
async function resolveBewerbungTeamName(bewerbung: FLBewerbung): Promise<string | null> {
  // The club list is asked for only where the application picked a club: a proposed school carries
  // its own name, and nothing else has to be read to address the message.
  const teams = bewerbung.schule === null && bewerbung.team_id !== null ? (await getTeamMemberships()).teams : [];

  return bewerbungTeamName(bewerbung, teams);
}

/**
 * Sends one decision's message to everyone the application names and reports who it reached.
 *
 * **The decision stands whatever this returns**: the write has committed and no endpoint takes it back.
 */
async function notifyBewerbung({
  operation,
  betreff,
  bewerbung,
  buildMail,
}: {
  operation: string;
  /** The bare noun the report inflects: „Zusage“, „Absage“. */
  betreff: BewerbungBetreff;
  bewerbung: FLBewerbung;
  /**
   * Composed from the club's name, resolved once here rather than at each call site, and from the
   * seats the reader in hand holds — the one part of a decision's message that differs per recipient.
   */
  buildMail: (teamName: string, rollenText: string) => BewerbungEmail;
}): Promise<string> {
  let teamName: string | null;

  try {
    teamName = await resolveBewerbungTeamName(bewerbung);
  } catch (error) {
    // The decision has committed by the time this runs, so a read that fails on the way to the
    // message must not come back as a write that did not happen. Name only, never the error
    // (`docs/logging/spec.md :: L9`).
    logger.error("bewerbung.mail_failed", undefined, {
      error_code: "FE-MAIL-002",
      name: error instanceof Error ? error.name : undefined,
      operation: operation,
    });

    return `Die ${betreff} konnte nicht verschickt werden. Melde Dich selbst bei den Kontaktpersonen der Bewerbung.`;
  }

  if (teamName === null) {
    return `Zu dieser Bewerbung ist kein Teamname hinterlegt, deshalb ging die ${betreff} an niemanden raus.`;
  }

  const benanntesTeam = teamName;

  const outcome = await sendBewerbungMail({
    operation: operation,
    recipients: collectBewerbungEmpfaenger(bewerbung.kontakte),
    buildMail: (rollenText) => buildMail(benanntesTeam, rollenText),
  });

  return describeBewerbungMail(betreff, outcome);
}

/**
 * Accepts the application, and tells the people who applied.
 *
 * **IRREVERSIBLE**: `saison_teams` has no DELETE, so a club entered in error leaves only through an
 * `austritt`. The control pressing this arms first.
 */
export async function annehmenBewerbungAction(
  rawPayload: FLAnnehmenBewerbungPayload,
): Promise<ActionResult<{ updated_document?: FLBewerbung; team_id?: string }>> {
  return runAdminMutation("annehmenBewerbungAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLAnnehmenBewerbungPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The refusal belongs in the panel that asked, not on the error page.
    let annahmeOperation;
    try {
      annahmeOperation = await annehmenBewerbung(validated.data);
    } catch (error) {
      const refusal = mapTriageRefusal(error);
      if (refusal) return { success: false, ...refusal };
      throw error;
    }

    if (!annahmeOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Bewerbung wurde nicht angenommen", repair: "Versuche es erneut" }) };
    }

    // A club was created or entered, which is what the cached team reads answer. The granular tag
    // beside the base one: a junction write holds only the season it wrote into
    // (`docs/frontend/spec.md` §1.4).
    updateTag("teams");
    updateTag(`teams:saison_id:${annahmeOperation.saison_id}`);

    const zustellung = await notifyBewerbung({
      operation: "annehmenBewerbungAction",
      betreff: "Zusage",
      bewerbung: annahmeOperation.updated_document,
      buildMail: (teamName, rollenText) =>
        buildBewerbungZusageEmail({
          teamName: teamName,
          saisonId: annahmeOperation.saison_id,
          // The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is
          // not production must not mail production links (`docs/frontend/spec.md :: I186`).
          origin: frontend_config.AUTH_URL,
          rollenText: rollenText,
          gruppe: annahmeOperation.gruppe,
          // Rendered here: the label lives in
          // `fl_frontend/src/features/teams/constants.ts :: TRIKOT_FARBE_OPTIONS`, which
          // `core/bewerbungEmail.ts` may not import.
          trikotFarbeLabel: annahmeOperation.trikot_farbe === null ? null : trikotFarbeLabel(annahmeOperation.trikot_farbe),
          // Off the STORED application rather than off any form: the acceptance payload carries no
          // wish, and the message names what the school actually submitted.
          wunschgegner: annahmeOperation.updated_document.wunschgegner,
        }),
    });

    const aufnahme = describeAufnahme({
      createdTeam: annahmeOperation.created_team,
      gruppe: annahmeOperation.gruppe,
      saisonId: annahmeOperation.saison_id,
    });

    return {
      success: true,
      updated_document: annahmeOperation.updated_document,
      team_id: annahmeOperation.team_id,
      message: `${aufnahme} ${zustellung}`,
    };
  });
}

/**
 * Declines the application, recording who decided and the reason they gave, and tells the people who
 * applied.
 */
export async function ablehnenBewerbungAction(
  rawPayload: FLAblehnenBewerbungPayload,
): Promise<ActionResult<{ updated_document?: FLBewerbung }>> {
  return runAdminMutation("ablehnenBewerbungAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLAblehnenBewerbungPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    let absageOperation;
    try {
      absageOperation = await ablehnenBewerbung(validated.data);
    } catch (error) {
      const refusal = mapTriageRefusal(error);
      if (refusal) return { success: false, ...refusal };
      throw error;
    }

    if (!absageOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Bewerbung wurde nicht abgelehnt", repair: "Versuche es erneut" }) };
    }

    // Nothing to invalidate, unlike the acceptance: this moves the application's own `status` and
    // `entscheidung`, and no cached read holds an application — both triage reads are uncached.

    const zustellung = await notifyBewerbung({
      operation: "ablehnenBewerbungAction",
      betreff: "Absage",
      bewerbung: absageOperation.updated_document,
      buildMail: (teamName, rollenText) =>
        buildBewerbungAbsageEmail({
          teamName: teamName,
          saisonId: absageOperation.updated_document.saison_id,
          origin: frontend_config.AUTH_URL,
          rollenText: rollenText,
          // The administrator's own wording, carried verbatim into the message.
          grund: validated.data.grund,
        }),
    });

    return {
      success: true,
      updated_document: absageOperation.updated_document,
      message: `Die Bewerbung ist abgelehnt. ${zustellung}`,
    };
  });
}

/** A re-send 409 as the message it should render, or `null` when the code is none of these. */
function mapEinwilligungErneutRefusal(error: unknown): { error?: string } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  switch (error.serverErrorCode) {
    // The code the two decisions answer, given the re-send's own words: a link minted against a
    // decided application would ask somebody to confirm a seat nothing is waiting for.
    case "REQ-BEWERBUNG-001":
      return {
        error: buildRefusal({
          reason: "Über diese Bewerbung ist schon entschieden worden, und ein neuer Link wäre nicht mehr zu beantworten",
          repair: "Lade die Seite neu",
        }),
      };
    // Answered, declined, or a seat an application from before the workflow holds: one sentence for
    // all three, because the control is offered from a page whose state has since moved.
    case "REQ-BEWERBUNG-011":
      return {
        error: buildRefusal({
          reason: "Für diese Rolle steht keine Bestätigung mehr aus",
          repair: "Lade die Seite neu",
        }),
      };
    default:
      return null;
  }
}

/** The queue holds an application the retention sweep can have taken since the page was drawn. */
const BEWERBUNG_WEG = buildRefusal({ reason: "Diese Bewerbung gibt es nicht mehr", repair: "Lade die Seite neu" });

/** A seat with nobody in it shows no control at all, so a press reaching this came off a page whose state has moved. */
const SITZ_LEER = buildRefusal({ reason: "Für diese Rolle steht niemand mehr in der Bewerbung", repair: "Lade die Seite neu" });

/** The correction beside this control is the repair, so the sentence sends the administrator there rather than nowhere. */
const KEINE_ADRESSE = "Zu dieser Rolle steht keine E-Mail-Adresse in der Bewerbung. Trage zuerst eine ein.";

/** A confirmation asks somebody to confirm for a named school, and `REQ-BEWERBUNG-002` refuses to accept this row anyway. */
const KEIN_TEAM = buildRefusal({ reason: "Diese Bewerbung nennt kein Team", repair: "Lehne die Bewerbung ab" });

/** What the press cost where no message went out: the mint voided the seat's previous link on its way. */
const KEIN_LINK_VERSCHICKT = buildRefusal({
  reason: "Der alte Link gilt nicht mehr, und die E-Mail mit dem neuen ging nicht raus",
  repair: "Versuche es noch einmal",
});

/**
 * The token is minted and the deadline moved by the time this runs, so each ANSWER reports a write
 * that stands: a refused send is a message to try again rather than a write that did not happen.
 */
async function sendeBestaetigungErneut({
  bewerbungId,
  saisonId,
  person,
  benanntesTeam,
  sitze,
  token,
}: {
  bewerbungId: string;
  saisonId: string;
  person: { vorname: string; email: string };
  benanntesTeam: string;
  /** Every seat this one link answers for. Phrased here rather than by each caller, so the message and the delivery record name one set. */
  sitze: readonly KontaktRolle[];
  token: string;
}): Promise<{ verschickt: true; message: string } | { verschickt: false; error: string }> {
  let frist: string | null;

  try {
    // Read AFTER the write: the deadline this message states is the one the re-send just set, and a
    // frontend clock reckoning fourteen days itself would disagree with the server across midnight.
    const gelesen = await getBewerbungById(bewerbungId);
    if (gelesen === null) return { verschickt: false, error: KEIN_LINK_VERSCHICKT };

    frist = gelesen.bewerbung.bestaetigungsfrist;
  } catch (error) {
    // Name only, never the error, and never the token (`docs/logging/spec.md :: L9`).
    logger.error("bewerbung.mail_failed", undefined, {
      error_code: "FE-MAIL-002",
      name: error instanceof Error ? error.name : undefined,
      operation: "einwilligungErneutSendenAction",
    });

    return { verschickt: false, error: KEIN_LINK_VERSCHICKT };
  }

  // Thrown rather than refused: the endpoint writes this deadline in the same update that mints the
  // token, so an application answering none afterwards is a broken contract and not a state an
  // administrator has anything to do about.
  if (frist === null) throw new Error("the re-send answered no Bestätigungsfrist for the application it had just written");

  const fristText = formatSpielDatum(frist);
  const origin = frontend_config.AUTH_URL;

  const sitzeText = rollenText(sitze);

  const outcome = await sendBewerbungMail({
    operation: "einwilligungErneutSendenAction",
    // No idempotency key: the token in this message is minted per press, and a key reused over a
    // changed body is refused rather than collapsed.
    auftrag: { bewerbungId: bewerbungId, anlass: "erneut" },
    recipients: [{ address: person.email, rollen: sitze, rollenText: sitzeText }],
    buildMail: () =>
      buildBewerbungBestaetigungEmail({
        saisonId: saisonId,
        origin: origin,
        schule: benanntesTeam,
        // One link whatever it answers for: a person holding two seats reads one control, and the
        // role text beside it is what tells them the answer covers both.
        seats: [{ vorname: person.vorname, rolleText: sitzeText, link: bestaetigungsLink(origin, token) }],
        fristText: fristText,
      }),
  });

  return outcome.unreachable.length === 0
    ? { verschickt: true, message: `Der neue Link ging an ${person.email}.` }
    : { verschickt: false, error: KEIN_LINK_VERSCHICKT };
}

/**
 * No confirmation step: a second link is undone by ignoring it, and the seat's own answer is what
 * the league acts on either way.
 */
export async function einwilligungErneutSendenAction(rawPayload: FLEinwilligungErneutPayload): Promise<ActionResult> {
  return runAdminMutation("einwilligungErneutSendenAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLEinwilligungErneutPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // Unguarded, and BEFORE the mint: nothing has been written yet, so a throw here is a failure to
    // report rather than the seat's live link spent on a message this press could never compose.
    const gelesen = await getBewerbungById(validated.data.id);

    if (gelesen === null) return { success: false, error: BEWERBUNG_WEG };

    const { bewerbung } = gelesen;
    const person = bewerbung.kontakte[validated.data.rolle];

    if (person === null) return { success: false, error: SITZ_LEER };
    if (person.email === "") return { success: false, error: KEINE_ADRESSE };

    const benanntesTeam = await resolveBewerbungTeamName(bewerbung);

    if (benanntesTeam === null) return { success: false, error: KEIN_TEAM };

    let erneutOperation;
    try {
      erneutOperation = await erneutSendenEinwilligung(validated.data);
    } catch (error) {
      const refusal = mapEinwilligungErneutRefusal(error);
      if (refusal) return { success: false, ...refusal };
      throw error;
    }

    if (!erneutOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Link wurde nicht neu verschickt", repair: "Versuche es erneut" }) };
    }

    // Nothing to invalidate, as on the decline: this moves the application's own confirmation block
    // and its deadline, and no cached read holds an application — both triage reads are uncached.

    const zustellung = await sendeBestaetigungErneut({
      bewerbungId: validated.data.id,
      saisonId: bewerbung.saison_id,
      person: person,
      benanntesTeam: benanntesTeam,
      sitze: gepaarteSitze(bewerbung, validated.data.rolle),
      token: erneutOperation.token,
    });

    return zustellung.verschickt ? { success: true, message: zustellung.message } : { success: false, error: zustellung.error };
  });
}

/** A correction 409 as the message it should render, or `null` when the code is none of these. */
function mapKontaktEmailRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  switch (error.serverErrorCode) {
    case "REQ-BEWERBUNG-001":
      return {
        error: buildRefusal({
          reason: "Über diese Bewerbung ist schon entschieden worden, und ihre Angaben stehen damit fest",
          repair: "Lade die Seite neu",
        }),
      };
    // The pencil stands on a seat the page drew as outstanding, so the person answered under it: the
    // correction is refused because their own answer named this address, not because a rule shut a box.
    case "REQ-BEWERBUNG-011":
      return {
        error: buildRefusal({
          reason: "Für diese Rolle hat die Person inzwischen selbst geantwortet, und danach wird ihre Adresse nicht mehr geändert",
          repair: "Lade die Seite neu",
        }),
      };
    // Under the field rather than over the panel: the box holding the refused address is the one
    // thing to change, and the submission words the same collision the same way.
    case "REQ-BEWERBUNG-014":
      return { fieldErrors: { email: "Diese E-Mail-Adresse ist schon bei einer anderen Person eingetragen." } };
    default:
      return null;
  }
}

/**
 * Rewrites one contact person's e-mail address and sends a fresh link to it. **The write stands
 * whatever the message did**, so a refused send is a link to try again rather than a correction that
 * did not happen.
 */
export async function kontaktEmailKorrigierenAction(
  rawPayload: FLBewerbungKontaktEmailPayload,
): Promise<ActionResult<{ verschickt?: boolean }>> {
  return runAdminMutation("kontaktEmailKorrigierenAction", async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLBewerbungKontaktEmailPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // BEFORE the write, as the re-send reads: nothing has been rewritten yet, so a throw here costs
    // a report rather than the seat's live link spent on a message this press could never compose.
    const gelesen = await getBewerbungById(validated.data.id);

    if (gelesen === null) return { success: false, error: BEWERBUNG_WEG };

    const { bewerbung } = gelesen;
    const person = bewerbung.kontakte[validated.data.rolle];

    if (person === null) return { success: false, error: SITZ_LEER };

    const benanntesTeam = await resolveBewerbungTeamName(bewerbung);

    if (benanntesTeam === null) return { success: false, error: KEIN_TEAM };

    let korrekturOperation;
    try {
      korrekturOperation = await korrigierenKontaktEmail(validated.data);
    } catch (error) {
      const refusal = mapKontaktEmailRefusal(error);
      if (refusal) return { success: false, ...refusal };
      throw error;
    }

    if (!korrekturOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Adresse wurde nicht geändert", repair: "Versuche es erneut" }) };
    }

    // Nothing to invalidate, as on the decline: this moves the application's own contact block and
    // its confirmation entry, and no cached read holds an application.

    let zustellung;
    try {
      zustellung = await sendeBestaetigungErneut({
        bewerbungId: validated.data.id,
        saisonId: bewerbung.saison_id,
        // The address the write just stored, never the one the read still holds: the message the
        // administrator asked for is the one going to the corrected mailbox.
        person: { vorname: person.vorname, email: validated.data.email },
        benanntesTeam: benanntesTeam,
        sitze: gepaarteSitze(bewerbung, validated.data.rolle),
        token: korrekturOperation.token,
      });
    } catch (error) {
      // The address is stored by the time this runs, so a throw escaping here would answer a
      // correction that stands with „nicht korrigiert“. Name only, never the error or the token
      // (`docs/logging/spec.md :: L9`).
      logger.error("bewerbung.mail_failed", undefined, {
        error_code: "FE-MAIL-002",
        name: error instanceof Error ? error.name : undefined,
        operation: "kontaktEmailKorrigierenAction",
      });

      return { success: true, verschickt: false, message: KEIN_LINK_VERSCHICKT };
    }

    return zustellung.verschickt
      ? { success: true, verschickt: true, message: zustellung.message }
      : { success: true, verschickt: false, message: zustellung.error };
  });
}
