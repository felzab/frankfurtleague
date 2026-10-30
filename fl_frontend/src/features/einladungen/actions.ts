"use server";

import { isFreshlySignedIn } from "@/core/auth";
import { frontend_config } from "@/core/config";
import { einladungsLink } from "@/core/einladungEmail";
import { isRecordMissing } from "@/core/errors";
import { KONTAKTE_ABSCHNITT } from "@/features/teams/constants";
import { getTeamSaisons } from "@/features/teams/queries";
import { refusalResult, refuseUnconfirmed, runAdminMutation } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { adressenSatz, versandSatz } from "./meldungen";
import { deleteEinladung, mailEinladung, postEinladung, postEinladungVersand } from "./mutations";
import { getEinladung, getEinladungVersandVorschau } from "./queries";
import { mapEinladungRefusal } from "./refusals";
import { EinladungMailenEingabeSchema, FLEinladungKeyPayloadSchema, FLEinladungVersandPayloadSchema } from "./schemas";

import type { FLEinladungVersandVorschauZeile, FLEinladungVersandZeile } from "@/core/generated/client/types";
import type { ActionResult, QueryResult } from "@/shared/types/types";
import type { z } from "zod";

/**
 * Mints the team's link for the season, closing any live one in the same transaction. **The raw link
 * value is answered once and stored nowhere**, so the panel showing it holds the only copy an
 * administrator will ever see.
 */
export async function postEinladungAction(
  rawPayload: z.input<typeof FLEinladungKeyPayloadSchema>,
): Promise<ActionResult<{ einladung_id: string; token: string; link: string }>> {
  return runAdminMutation("postEinladungAction", async (session) => {
    const validated = FLEinladungKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // A mint voiding a standing link is a step-up write and the first mint is not, so a read decides; made
    // only for a session past the window, the one it can refuse.
    const standing = isFreshlySignedIn(session) ? null : (await getEinladung(validated.data.team_id, validated.data.saison_id)).einladung;
    const unconfirmed = standing === null ? null : refuseUnconfirmed(session);
    if (unconfirmed !== null) return unconfirmed;

    let mintOperation;
    try {
      mintOperation = await postEinladung(validated.data);
    } catch (error) {
      const refusal = mapEinladungRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    return {
      success: true,
      einladung_id: mintOperation.einladung_id,
      token: mintOperation.token,
      // Spelled here and never in the panel: `frontend_config.AUTH_URL` is server-only, and a link
      // built in the browser would carry whichever host the page was opened on.
      link: einladungsLink(new URL(frontend_config.AUTH_URL).origin, mintOperation.token),
      message: "Der neue Link gilt ab sofort. Ein vorheriger Link öffnet nichts mehr.",
    };
  });
}

/**
 * Owes the team's live link to its confirmed contact seats. **A second press, never part of the mint**: the link is
 * shown for copying first, and this is what puts it in an inbox. Each mail mints a link of its own when it leaves, so
 * the copied one stays valid beside them.
 */
export async function mailEinladungAction(rawPayload: z.input<typeof EinladungMailenEingabeSchema>): Promise<ActionResult> {
  return runAdminMutation("mailEinladungAction", { stepUp: true }, async () => {
    const validated = EinladungMailenEingabeSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const { team_id, saison_id } = validated.data;
    const memberships = await getTeamSaisons();
    const membership =
      memberships.teams.find((candidate) => candidate.id === team_id)?.memberships.find((candidate) => candidate.saison_id === saison_id) ??
      null;

    if (membership?.kontakte == null) {
      return {
        success: false,
        error: buildRefusal({
          reason: "Für dieses Team sind in dieser Saison keine Kontaktdaten hinterlegt",
          repair: { before: "Trage sie", after: "ein, oder gib den Link von Hand weiter" },
          where: KONTAKTE_ABSCHNITT,
        }),
      };
    }

    let versandOperation;
    try {
      versandOperation = await mailEinladung(validated.data);
    } catch (error) {
      // A panel left open while somebody else replaced or withdrew the link names a row that opens nothing.
      if (isRecordMissing(error)) {
        return {
          success: false,
          error: buildRefusal({
            reason: "Dieser Link ist nicht mehr der offene Link dieses Teams",
            repair: "Lade die Seite neu und lege einen neuen Link an",
          }),
        };
      }
      throw error;
    }

    const gesamt = versandOperation.empfaenger.length;
    if (gesamt === 0) {
      return {
        success: false,
        error: buildRefusal({
          reason: "Keine Kontaktperson dieses Teams hat ihre Daten bisher selbst bestätigt",
          repair: "Warte auf eine Bestätigung, oder gib den Link von Hand weiter",
        }),
      };
    }

    return { success: true, message: adressenSatz(gesamt, gesamt) };
  });
}

/** Closes the team's live link. Nothing reverses it: the next link is a fresh mint with a fresh value. */
export async function deleteEinladungAction(rawPayload: z.input<typeof FLEinladungKeyPayloadSchema>): Promise<ActionResult> {
  return runAdminMutation("deleteEinladungAction", { stepUp: true }, async () => {
    const validated = FLEinladungKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    await deleteEinladung(validated.data);

    return { success: true, message: "Der Link öffnet ab sofort nichts mehr." };
  });
}

/**
 * Who the bulk send would write to, and why it would pass each of the others over. **Read-only**: it
 * reports what the press would do and writes nothing, as the fixture save's dry run does
 * (`fl_frontend/src/features/spiele/actions.ts :: previewAdminSpielDataAction`).
 */
export async function previewEinladungVersandAction(
  rawPayload: z.input<typeof FLEinladungVersandPayloadSchema>,
): Promise<QueryResult<{ zeilen: readonly FLEinladungVersandVorschauZeile[] }>> {
  return runAdminMutation("previewEinladungVersandAction", async () => {
    const validated = FLEinladungVersandPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // `?? false` for the endpoint's own default: the payload mirrors a request that may omit the
    // key, and this read has to name a value either way to describe the press it precedes.
    const vorschau = await getEinladungVersandVorschau(validated.data.id, validated.data.erneut ?? false);

    return { success: true, zeilen: vorschau.zeilen };
  });
}

/**
 * One press for every admitted team of the season: the endpoint gives each team it reaches a fresh link and owes it
 * to the team's confirmed seats in the same write, over the rule the preview read.
 */
export async function postEinladungVersandAction(
  rawPayload: z.input<typeof FLEinladungVersandPayloadSchema>,
): Promise<ActionResult<{ zeilen: readonly FLEinladungVersandZeile[]; gemeint: number; erreicht: number }>> {
  return runAdminMutation("postEinladungVersandAction", { stepUp: true }, async () => {
    const validated = FLEinladungVersandPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let versandOperation;
    try {
      versandOperation = await postEinladungVersand(validated.data);
    } catch (error) {
      const refusal = mapEinladungRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    const { zeilen } = versandOperation;
    // Every team this press meant to write to: a pass-over by the rule the preview showed is none, the league's own
    // failure to mint is one.
    const gemeint = zeilen.filter(
      (zeile) =>
        zeile.uebersprungen === null || zeile.uebersprungen === "erzeugung_fehlgeschlagen" || zeile.uebersprungen === "erzeugung_ungewiss",
    ).length;
    const erreicht = zeilen.filter((zeile) => zeile.empfaenger.length > 0).length;

    return { success: true, zeilen: zeilen, message: versandSatz(erreicht, gemeint, zeilen.length), gemeint: gemeint, erreicht: erreicht };
  });
}
