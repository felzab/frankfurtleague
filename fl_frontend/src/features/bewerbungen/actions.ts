"use server";

import { unstable_rethrow } from "next/navigation";

import { APIBadStatusError } from "@/core/errors";
import { getTeamSaisons } from "@/features/teams/queries";
import { logActionFailure } from "@/shared/utils/actionFailure";
import { refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { explainsItself } from "@/shared/utils/degradedRead";
import { buildRefusal, LADE_DIE_SEITE_NEU } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { ERNEUT_OHNE_ADRESSE } from "./constants";
import { ablehnenBewerbung, annehmenBewerbung, besetzenKontaktSitz, erneutSendenEinwilligung, korrigierenKontaktEmail } from "./mutations";
import { getBewerbungById } from "./queries";
import { mapEinwilligungErneutRefusal, mapKontaktEmailRefusal, mapKontaktSitzRefusal, mapTriageRefusal } from "./refusals";
import {
  FLAblehnenBewerbungPayloadSchema,
  FLAnnehmenBewerbungPayloadSchema,
  FLBewerbungKontaktEmailPayloadSchema,
  FLBewerbungKontaktSitzPayloadSchema,
  FLEinwilligungErneutPayloadSchema,
} from "./schemas";
import { bewerbungHerkunft, bewerbungTeamName, describeAufnahme } from "./utils";

import type {
  FLAblehnenBewerbungPayload,
  FLAnnehmenBewerbungPayload,
  FLBewerbung,
  FLBewerbungKontaktEmailPayload,
  FLBewerbungKontaktSitzPayload,
  FLKontaktRolle,
} from "@/core/generated/client/types";
import type { ActionResult } from "@/shared/types/types";
import type { BewerbungHerkunft } from "./constants";

/**
 * The club a confirmation link names. `null` where the application names neither a school nor a club, and nobody may
 * guess a name for a contact who never heard of the application.
 */
async function resolveBewerbungTeamName(bewerbung: FLBewerbung): Promise<string | null> {
  // The club list is asked for only where the application picked a club: a proposed school carries
  // its own name, and nothing else has to be read.
  const teams = bewerbung.schule === null && bewerbung.team_id !== null ? (await getTeamSaisons()).teams : [];

  return bewerbungTeamName(bewerbung, teams);
}

/**
 * What the refused application enters, read off the stored application for a duplicate key alone,
 * whose sentence it decides. `null` where that read fails, which leaves the key to the shared reader.
 */
async function kollisionsHerkunft(error: unknown, bewerbungId: string): Promise<BewerbungHerkunft | null> {
  if (!(error instanceof APIBadStatusError) || error.serverErrorCode !== "duplicate_key") return null;

  const gelesen = await getBewerbungById(bewerbungId).catch((failed: unknown) => {
    // A redirect the read's admin guard threw is a navigation, never a failed read.
    unstable_rethrow(failed);
    // Logged and settled, a contract break included: only the refusal's wording rests on this read.
    if (!explainsItself(failed)) logActionFailure("bewerbung.collision_unread", failed);
    return null;
  });

  return gelesen === null ? null : bewerbungHerkunft(gelesen.bewerbung);
}

/** What a decision tells the administrator about its mails, which the write owed every person of the application. */
const ENTSCHEIDUNG_GEHT_AN_ALLE = (betreff: "Zusage" | "Absage") => `Die ${betreff} geht an jede Kontaktperson.`;

/**
 * Accepts the application, and owes every person of it the acceptance in the same write.
 *
 * **IRREVERSIBLE**: `saison_teams` has no DELETE, so a club entered in error leaves only through an
 * `austritt`. The control pressing this arms first.
 */
export async function annehmenBewerbungAction(
  rawPayload: { id: string } & FLAnnehmenBewerbungPayload,
): Promise<ActionResult<{ team_id?: string }>> {
  return runAdminMutation("annehmenBewerbungAction", { stepUp: true }, async () => {
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

    const aufnahme = describeAufnahme({
      createdTeam: annahmeOperation.created_team,
      gruppe: annahmeOperation.gruppe,
      saisonId: annahmeOperation.saison_id,
    });

    return {
      success: true,
      team_id: annahmeOperation.team_id,
      message: `${aufnahme} ${ENTSCHEIDUNG_GEHT_AN_ALLE("Zusage")}`,
    };
  });
}

/** Declines the application, recording who decided and the reason they gave; every person of it is owed the decline. */
export async function ablehnenBewerbungAction(rawPayload: { id: string } & FLAblehnenBewerbungPayload): Promise<ActionResult> {
  return runAdminMutation("ablehnenBewerbungAction", { stepUp: true }, async () => {
    const validated = FLAblehnenBewerbungPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    try {
      await ablehnenBewerbung(validated.data);
    } catch (error) {
      const refusal = mapTriageRefusal(error, null);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    // No tag moves, unlike the acceptance: this moves the application's own `status` and
    // `entscheidung`, and no cached read holds an application. The spine's refresh is what brings
    // the uncached triage reads back.

    return { success: true, message: `Die Bewerbung ist abgelehnt. ${ENTSCHEIDUNG_GEHT_AN_ALLE("Absage")}` };
  });
}

/** The queue holds an application the retention sweep can have taken since the page was drawn. */
const BEWERBUNG_WEG = buildRefusal({ reason: "Diese Bewerbung gibt es nicht mehr", repair: LADE_DIE_SEITE_NEU });

/** A seat with nobody in it shows no control at all, so a press reaching this came off a page whose state has moved. */
const SITZ_LEER = buildRefusal({ reason: "Für diese Rolle steht niemand mehr in der Bewerbung", repair: LADE_DIE_SEITE_NEU });

/** A confirmation asks somebody to confirm for a named school, and `bewerbung_subject_unresolved` refuses to accept this row anyway. */
const KEIN_TEAM = buildRefusal({ reason: "Diese Bewerbung nennt kein Team", repair: "Lehne die Bewerbung ab" });

/** What a repair tells the administrator: its write owed the fresh link to the address it answered, in the same transaction. */
const linkSatz = (email: string): string => `Der neue Link geht an ${email}.`;

/**
 * No confirmation step: a second link is undone by ignoring it, and the seat's own answer is what
 * the league acts on either way.
 */
export async function einwilligungErneutSendenAction(rawPayload: { id: string; rolle: FLKontaktRolle }): Promise<ActionResult> {
  return runAdminMutation("einwilligungErneutSendenAction", { stepUp: true }, async () => {
    const validated = FLEinwilligungErneutPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // BEFORE the write: nothing has been written yet, so a press this application cannot answer costs no live link.
    const gelesen = await getBewerbungById(validated.data.id);

    if (gelesen === null) return { success: false, error: BEWERBUNG_WEG };

    const { bewerbung } = gelesen;
    const person = bewerbung.kontakte[validated.data.rolle];

    if (person === null) return { success: false, error: SITZ_LEER };
    if (person.email === "") return { success: false, error: ERNEUT_OHNE_ADRESSE };
    if ((await resolveBewerbungTeamName(bewerbung)) === null) return { success: false, error: KEIN_TEAM };

    let erneutOperation;
    try {
      erneutOperation = await erneutSendenEinwilligung(validated.data);
    } catch (error) {
      const refusal = mapEinwilligungErneutRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    // No tag moves, as on the decline: this moves the application's own confirmation block
    // and its deadline, and no cached read holds an application — both triage reads are uncached.

    // The address the WRITE matched, never the read above: a correction landing between the two moved the mailbox.
    return { success: true, message: linkSatz(erneutOperation.email) };
  });
}

/** Rewrites one contact person's e-mail address and owes a fresh link to it in the same write. */
export async function kontaktEmailKorrigierenAction(
  rawPayload: { id: string; rolle: FLKontaktRolle } & FLBewerbungKontaktEmailPayload,
): Promise<ActionResult> {
  return runAdminMutation("kontaktEmailKorrigierenAction", { stepUp: true }, async () => {
    const validated = FLBewerbungKontaktEmailPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // BEFORE the write, as the re-send reads.
    const gelesen = await getBewerbungById(validated.data.id);

    if (gelesen === null) return { success: false, error: BEWERBUNG_WEG };
    if (gelesen.bewerbung.kontakte[validated.data.rolle] === null) return { success: false, error: SITZ_LEER };
    if ((await resolveBewerbungTeamName(gelesen.bewerbung)) === null) return { success: false, error: KEIN_TEAM };

    let korrekturOperation;
    try {
      korrekturOperation = await korrigierenKontaktEmail(validated.data);
    } catch (error) {
      const refusal = mapKontaktEmailRefusal(error);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    // No tag moves, as on the decline: this moves the application's own contact block and
    // its confirmation entry, and no cached read holds an application.

    // The address the write just stored, never the one typed: the form its mail goes to.
    return { success: true, message: linkSatz(korrekturOperation.email) };
  });
}

/** Seats another person in an emptied seat and owes them their link in the same write. */
export async function besetzeKontaktSitzAction(
  rawPayload: { id: string; rolle: FLKontaktRolle } & FLBewerbungKontaktSitzPayload,
): Promise<ActionResult> {
  return runAdminMutation("besetzeKontaktSitzAction", { stepUp: true }, async () => {
    const validated = FLBewerbungKontaktSitzPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // BEFORE the write, as both repairs read: the school's name is what the link's mail names.
    const gelesen = await getBewerbungById(validated.data.id);

    if (gelesen === null) return { success: false, error: BEWERBUNG_WEG };
    if ((await resolveBewerbungTeamName(gelesen.bewerbung)) === null) return { success: false, error: KEIN_TEAM };

    let sitzOperation;
    try {
      sitzOperation = await besetzenKontaktSitz(validated.data);
    } catch (error) {
      const refusal = mapKontaktSitzRefusal(error);
      if (refusal) return refusalResult(refusal);
      throw error;
    }

    // No tag moves, for the correction's reason: this writes the application's own contact block and
    // its confirmation entry, and no cached read holds an application.

    // As stored, never as typed.
    return { success: true, message: linkSatz(sitzOperation.email) };
  });
}
