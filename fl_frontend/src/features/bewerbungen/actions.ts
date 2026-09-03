"use server";

import { updateTag } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { buildBewerbungAbsageEmail, buildBewerbungZusageEmail } from "@/core/bewerbungEmail";
import { APIBadStatusError } from "@/core/errors";
import { logger } from "@/core/logging";
import { trikotFarbeLabel } from "@/features/teams/constants";
import { getTeamMemberships } from "@/features/teams/queries";
import { ADMIN_FORBIDDEN, runAdminMutation, VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors } from "@/shared/utils/validation";

import { ablehnenBewerbung, annehmenBewerbung } from "./mutations";
import { collectBewerbungEmpfaenger, describeBewerbungMail, sendBewerbungMail } from "./notifications";
import { FLAblehnenBewerbungPayloadSchema, FLAnnehmenBewerbungPayloadSchema } from "./schemas";
import { bewerbungTeamName, describeAufnahme } from "./utils";

import type { BewerbungEmail } from "@/core/bewerbungEmail";
import type { FieldErrors } from "@/shared/utils/validation";
import type { BewerbungBetreff } from "./notifications";
import type { FLAblehnenBewerbungPayload, FLAnnehmenBewerbungPayload, FLBewerbung } from "./schemas";

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
    // reads a club through a stricter model, so a school's details can make no club. Which field fails
    // stays off the wire, and no edit path exists.
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
    case "REQ-ENTER-001":
      return {
        error: buildRefusal({
          reason: "Die Saison dieser Bewerbung ist nicht mehr in Planung, und aufgenommen wird nur in eine geplante Saison",
          repair: "Lehne die Bewerbung ab",
        }),
      };
    // On the picker, which is the field at fault and the one the admin can move.
    case "REQ-ENTER-002":
      return { fieldErrors: { gruppe: "Diese Gruppe gibt es in der Saison der Bewerbung nicht." } };
    case "REQ-ENTER-003":
      return { fieldErrors: { gruppe: "Diese Gruppe ist voll. Wähle eine andere." } };
    // A new school's club is created with the Kürzel the school typed, and a club's only unique key
    // is that Kürzel, so this 409 IS the collision. The generic conflict message names no way out,
    // and an application cannot be edited.
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
      name: error instanceof Error ? error.name : undefined,
      error_code: "FE-MAIL-002",
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
export async function annehmenBewerbungAction(rawPayload: FLAnnehmenBewerbungPayload): Promise<{
  success: boolean;
  updated_document?: FLBewerbung;
  team_id?: string;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
}> {
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
      success: Boolean(annahmeOperation.acknowledged),
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
): Promise<{ success: boolean; updated_document?: FLBewerbung; message?: string; error?: string; fieldErrors?: FieldErrors }> {
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
          rollenText: rollenText,
          // The administrator's own wording, carried verbatim into the message.
          grund: validated.data.grund,
        }),
    });

    return {
      success: Boolean(absageOperation.acknowledged),
      updated_document: absageOperation.updated_document,
      message: `Die Bewerbung ist abgelehnt. ${zustellung}`,
    };
  });
}
