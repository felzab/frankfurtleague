"use server";

import { refresh, updateTag } from "next/cache";

import { buildBewerbungAbsageEmail, buildBewerbungBestaetigungEmail, buildBewerbungZusageEmail } from "@/core/bewerbungEmail";
import { frontend_config } from "@/core/config";
import { LIGA_KENNTNISNAHME } from "@/core/einwilligung";
import { APIBadStatusError } from "@/core/errors";
import { logger } from "@/core/logging";
import { trikotFarbeLabel } from "@/features/teams/constants";
import { getTeamMemberships } from "@/features/teams/queries";
import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { formatSpielDatum } from "@/shared/utils/format";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { bestaetigungsLink } from "./bestaetigungLink";
import { gepaarteSitze } from "./bestaetigungStand";
import { ERNEUT_OHNE_ADRESSE } from "./constants";
import { ablehnenBewerbung, annehmenBewerbung, besetzenKontaktSitz, erneutSendenEinwilligung, korrigierenKontaktEmail } from "./mutations";
import { collectBewerbungEmpfaenger, describeBewerbungMail, rollenText, sendBewerbungMail } from "./notifications";
import { getBewerbungById } from "./queries";
import { mapEinwilligungErneutRefusal, mapKontaktEmailRefusal, mapKontaktSitzRefusal, mapTriageRefusal } from "./refusals";
import {
  FLAblehnenBewerbungPayloadSchema,
  FLAnnehmenBewerbungPayloadSchema,
  FLBewerbungKontaktEmailPayloadSchema,
  FLBewerbungKontaktSitzPayloadSchema,
  FLEinwilligungErneutPayloadSchema,
} from "./schemas";
import { BEWERBUNG_VERALTET, bewerbungHerkunft, bewerbungTeamName, describeAufnahme, nenntLaufendeFassung } from "./utils";

import type { BewerbungEmail } from "@/core/bewerbungEmail";
import type { KontaktRolle } from "@/features/teams/constants";
import type { ActionResult } from "@/shared/types/types";
import type { BewerbungHerkunft } from "./constants";
import type { BewerbungBetreff } from "./notifications";
import type {
  FLAblehnenBewerbungPayload,
  FLAnnehmenBewerbungPayload,
  FLBewerbung,
  FLBewerbungKontaktEmailPayload,
  FLBewerbungKontaktSitzPayload,
  FLEinwilligungErneutPayload,
} from "./schemas";

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
 * What the refused application enters, read off the stored application for a duplicate key alone,
 * whose sentence it decides. `null` where that read fails, which leaves the key to the shared reader.
 */
async function kollisionsHerkunft(error: unknown, bewerbungId: string): Promise<BewerbungHerkunft | null> {
  if (!(error instanceof APIBadStatusError) || error.serverErrorCode !== "DB-COMMON-002") return null;

  const gelesen = await getBewerbungById(bewerbungId).catch(() => null);

  return gelesen === null ? null : bewerbungHerkunft(gelesen.bewerbung);
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
  return runAdminMutation("annehmenBewerbungAction", { readOnly: false }, async () => {
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
      const refusal = mapTriageRefusal(error, await kollisionsHerkunft(error, validated.data.id));
      if (refusal) return refusalResult(refusal);
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
  return runAdminMutation("ablehnenBewerbungAction", { readOnly: false }, async () => {
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
      const refusal = mapTriageRefusal(error, null);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    if (!absageOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Bewerbung wurde nicht abgelehnt", repair: "Versuche es erneut" }) };
    }

    // No tag moves, unlike the acceptance: this moves the application's own `status` and
    // `entscheidung`, and no cached read holds an application. The spine's refresh is what brings
    // the uncached triage reads back.

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

/** The queue holds an application the retention sweep can have taken since the page was drawn. */
const BEWERBUNG_WEG = buildRefusal({ reason: "Diese Bewerbung gibt es nicht mehr", repair: "Lade die Seite neu" });

/** A seat with nobody in it shows no control at all, so a press reaching this came off a page whose state has moved. */
const SITZ_LEER = buildRefusal({ reason: "Für diese Rolle steht niemand mehr in der Bewerbung", repair: "Lade die Seite neu" });

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
  return runAdminMutation("einwilligungErneutSendenAction", { readOnly: false }, async () => {
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
    if (person.email === "") return { success: false, error: ERNEUT_OHNE_ADRESSE };

    const benanntesTeam = await resolveBewerbungTeamName(bewerbung);

    if (benanntesTeam === null) return { success: false, error: KEIN_TEAM };

    let erneutOperation;
    try {
      erneutOperation = await erneutSendenEinwilligung(validated.data);
    } catch (error) {
      const refusal = mapEinwilligungErneutRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!erneutOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Link wurde nicht neu verschickt", repair: "Versuche es erneut" }) };
    }

    // No tag moves, as on the decline: this moves the application's own confirmation block
    // and its deadline, and no cached read holds an application — both triage reads are uncached.

    const zustellung = await sendeBestaetigungErneut({
      bewerbungId: validated.data.id,
      saisonId: bewerbung.saison_id,
      // The address and the seats the WRITE matched, never the read above: a correction landing
      // between the two moved the mailbox, and this link replaces the one the correction mailed.
      person: { vorname: person.vorname, email: erneutOperation.email },
      benanntesTeam: benanntesTeam,
      sitze: erneutOperation.rollen,
      token: erneutOperation.token,
    });

    // The spine refreshes a success alone, and a refused send leaves the mint standing: the seat's old
    // link is spent and its deadline moved.
    if (!zustellung.verschickt) refresh();

    return zustellung.verschickt ? { success: true, message: zustellung.message } : { success: false, error: zustellung.error };
  });
}

/**
 * Rewrites one contact person's e-mail address and sends a fresh link to it. **The write stands
 * whatever the message did**, so a refused send is a link to try again rather than a correction that
 * did not happen.
 */
export async function kontaktEmailKorrigierenAction(
  rawPayload: FLBewerbungKontaktEmailPayload,
): Promise<ActionResult<{ verschickt?: boolean }>> {
  return runAdminMutation("kontaktEmailKorrigierenAction", { readOnly: false }, async () => {
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
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    if (!korrekturOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Adresse wurde nicht geändert", repair: "Versuche es erneut" }) };
    }

    // No tag moves, as on the decline: this moves the application's own contact block and
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

/**
 * **The seat stands filled whatever the message did**, as the correction's address does: a refused
 * send is a link to try again rather than a person who was never seated.
 */
export async function besetzeKontaktSitzAction(rawPayload: FLBewerbungKontaktSitzPayload): Promise<ActionResult<{ verschickt?: boolean }>> {
  return runAdminMutation("besetzeKontaktSitzAction", { readOnly: false }, async () => {
    // Judged before the parse, as the confirmation handlers judge theirs: a page opened before a deploy
    // moved the label would seat a person under words the build does not serve, and no key replays a reseat.
    if (!nenntLaufendeFassung(rawPayload, LIGA_KENNTNISNAHME.textVersion)) return { success: false, error: BEWERBUNG_VERALTET };

    const validated = FLBewerbungKontaktSitzPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // BEFORE the write, as both repairs read: the school's name is what the message names, and a
    // throw here costs a report rather than a seat filled behind a message nobody could compose.
    const gelesen = await getBewerbungById(validated.data.id);

    if (gelesen === null) return { success: false, error: BEWERBUNG_WEG };

    const benanntesTeam = await resolveBewerbungTeamName(gelesen.bewerbung);

    if (benanntesTeam === null) return { success: false, error: KEIN_TEAM };

    let sitzOperation;
    try {
      sitzOperation = await besetzenKontaktSitz(validated.data);
    } catch (error) {
      const refusal = mapKontaktSitzRefusal(error);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    if (!sitzOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Rolle wurde nicht neu besetzt", repair: "Versuche es erneut" }) };
    }

    // No tag moves, for the correction's reason: this writes the application's own contact block and
    // its confirmation entry, and no cached read holds an application.

    let zustellung;
    try {
      zustellung = await sendeBestaetigungErneut({
        bewerbungId: validated.data.id,
        saisonId: gelesen.bewerbung.saison_id,
        person: { vorname: validated.data.vorname, email: validated.data.email },
        benanntesTeam: benanntesTeam,
        // The WRITE's own answer, never `gepaarteSitze`: that helper mirrors `paired_seat`, which
        // drops an emptied seat from the pair, and every seat this write filled was emptied.
        sitze: sitzOperation.rollen,
        token: sitzOperation.token,
      });
    } catch (error) {
      // The person is seated by the time this runs, so a throw escaping here would answer a write
      // that stands with „nicht besetzt“. Name only, never the error or the token
      // (`docs/logging/spec.md :: L9`).
      logger.error("bewerbung.mail_failed", undefined, {
        error_code: "FE-MAIL-002",
        name: error instanceof Error ? error.name : undefined,
        operation: "besetzeKontaktSitzAction",
      });

      return { success: true, verschickt: false, message: KEIN_LINK_VERSCHICKT };
    }

    return zustellung.verschickt
      ? { success: true, verschickt: true, message: zustellung.message }
      : { success: true, verschickt: false, message: zustellung.error };
  });
}
