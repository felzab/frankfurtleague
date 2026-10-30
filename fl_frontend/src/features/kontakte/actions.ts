"use server";

import { drainSoon } from "@/core/afterResponse";
import { isFreshlySignedIn } from "@/core/auth";
import { getLaufendesLabel } from "@/core/einwilligung";
import { formatAufzaehlung } from "@/core/format";
import { getTeamMemberships } from "@/features/teams/queries";
import { refuseUnconfirmed, runAdminMutation } from "@/shared/utils/adminMutation";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { kontakteMayMoveLinks } from "./linkMint";
import { einladeKontakt, patchSaisonTeamKontakte } from "./mutations";
import { mapEinladenRefusal, mapKontakteRefusal } from "./refusals";
import { FLKontaktEinladenPayloadSchema, KontakteSpeichernEingabeSchema } from "./schemas";
import { mitLaufenderFassung } from "./utils";

import type { FLKontaktMint, FLKontaktRolle, FLSaisonTeamKontakte } from "@/core/generated/client/types";
import type { ActionResult } from "@/shared/types/types";
import type { KontakteSpeichernEingabe } from "./schemas";

/**
 * What the administrator is told of the links a write owed: the addresses the write's own transaction read, never the
 * ones this caller sent, a save landing between the two having moved a mailbox. The Postausgang mails them at once,
 * behind the response; the editor then shows what became of each.
 */
function linkSatz(owed: readonly FLKontaktMint[]): string {
  const adressen = formatAufzaehlung(owed.map(({ email }) => email));

  return owed.length === 1 ? `Der Bestätigungslink geht an ${adressen}.` : `Die Bestätigungslinks gehen an ${adressen}.`;
}

/**
 * The three seats one club holds for one season, written whole. The season's competition facts stay
 * on `PATCH /teams/{team_id}/saisons/{saison_id}`: they answer a different question and belong to a
 * different page.
 */
export async function patchSaisonTeamKontakteAction(
  // Composed by the caller: the editor's own guard refuses a body before this is reached, and a
  // field no control renders is a block with no repair.
  rawPayload: KontakteSpeichernEingabe,
): Promise<ActionResult<{ versandSatz?: string }>> {
  return runAdminMutation("patchSaisonTeamKontakteAction", async (session) => {
    const validated = KontakteSpeichernEingabeSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // A save minting or voiding a link is a step-up write, and one moving none is not. The stored row
    // is read only for a session past the window.
    const movesLinks =
      validated.data.kontakte !== null &&
      !isFreshlySignedIn(session) &&
      kontakteMayMoveLinks(await gespeicherteKontakte(validated.data), validated.data.kontakte);
    const unconfirmed = validated.data.kontakte === null || movesLinks ? refuseUnconfirmed(session) : null;
    if (unconfirmed !== null) return unconfirmed;

    // `validated.data` and never `rawPayload`, whose type is a promise the wire does not keep.
    // The refusal belongs on the page that asked, not on the error page.
    let saisonTeam;
    try {
      // Read at the write, never off the page: a deploy between the editor's open and this press
      // moves the label a new acceptance names.
      const kontakte =
        validated.data.kontakte === null ? null : mitLaufenderFassung(validated.data.kontakte, await getLaufendesLabel("bewerbung"));
      saisonTeam = await patchSaisonTeamKontakte({ ...validated.data, kontakte });
    } catch (error) {
      const refusal = mapKontakteRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    // No tag moves: no cached read holds a contact person.
    // `fl_frontend/src/features/teams/queries.ts :: getTeamMemberships` is memoised per render pass
    // and not across requests, no public team read carries `kontakte`, and the admin's own list is
    // uncached.

    // Owed in the save's own transaction, one per person it newly seated.
    const owed = saisonTeam.bestaetigungen;
    if (owed.length > 0) drainSoon();

    return {
      success: true,
      // The cleared block is a removal rather than a save, and it is the one outcome a reader would
      // not expect to have to check for.
      message: validated.data.kontakte === null ? "Kontakte entfernt" : "Kontakte gespeichert",
      // Its own field rather than folded into the message: the editor's toast says it in place of the
      // save's sentence, and a save that owed no link has no sentence to hand it.
      versandSatz: owed.length === 0 ? undefined : linkSatz(owed),
    };
  });
}

/**
 * A fresh link for one unconfirmed seat, the seat's earlier one opening nothing afterwards. **Always a
 * step-up write**: every call owes a bearer link.
 */
export async function einladeKontaktAction(rawPayload: { team_id: string; saison_id: string; rolle: FLKontaktRolle }): Promise<ActionResult> {
  return runAdminMutation("einladeKontaktAction", { stepUp: true }, async () => {
    const validated = FLKontaktEinladenPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The refusal belongs beside the seat that asked, not on the error page.
    let mintOperation;
    try {
      mintOperation = await einladeKontakt(validated.data);
    } catch (error) {
      const refusal = mapEinladenRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    drainSoon();

    return {
      success: true,
      message: `${linkSatz([mintOperation.bestaetigung])} Der vorherige Link gilt nicht mehr.`,
    };
  });
}

/**
 * The one read serving a stored block, memoised for the request. A block moving between it and the
 * write is refused there (`REQ-KONTAKT-001`), so the race costs a sentence rather than a stale judgement.
 */
async function gespeicherteKontakte({ team_id, saison_id }: Pick<KontakteSpeichernEingabe, "team_id" | "saison_id">) {
  const { teams } = await getTeamMemberships();
  const gespeichert: FLSaisonTeamKontakte | null =
    teams.find(({ id }) => id === team_id)?.memberships.find((membership) => membership.saison_id === saison_id)?.kontakte ?? null;

  return gespeichert;
}
