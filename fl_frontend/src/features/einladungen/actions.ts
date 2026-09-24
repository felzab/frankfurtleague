"use server";

import { refresh } from "next/cache";

import { getAdminSession } from "@/core/auth";
import { frontend_config } from "@/core/config";
import { buildEinladungEmail } from "@/core/einladungEmail";
import { getTeamMemberships } from "@/features/teams/queries";
import { sendZielMail } from "@/features/zustellung/notifications";
import { ADMIN_FORBIDDEN, refusalResult, runAdminMutation } from "@/shared/utils/adminMutation";
import { getGermanTodayStr } from "@/shared/utils/date";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { einladungsLink } from "./einladungLink";
import { bestaetigteEmpfaenger } from "./empfaenger";
import { adressenSatz, versandSatz, ZURUECKGEHALTEN } from "./meldungen";
import { deleteEinladung, postEinladung, postEinladungVersand } from "./mutations";
import { getEinladung, getEinladungVersandVorschau } from "./queries";
import { mapEinladungRefusal } from "./refusals";
import { FLEinladungKeyPayloadSchema, FLEinladungMailPayloadSchema, FLEinladungVersandPayloadSchema } from "./schemas";

import type { ActionResult, QueryResult } from "@/shared/types/types";
import type { FLEinladungKeyPayload, FLEinladungMailPayload, FLEinladungVersandPayload, FLEinladungVersandVorschauZeile } from "./schemas";
import type { EinladungVersandErgebnis } from "./types";

/**
 * Mints the team's link for the season, closing any live one in the same transaction. **The raw link
 * value is answered once and stored nowhere**, so the panel showing it holds the only copy an
 * administrator will ever see.
 */
export async function postEinladungAction(
  rawPayload: FLEinladungKeyPayload,
): Promise<ActionResult<{ einladung_id: string; token: string; link: string }>> {
  return runAdminMutation("postEinladungAction", { readOnly: false }, async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLEinladungKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let mintOperation;
    try {
      mintOperation = await postEinladung(validated.data);
    } catch (error) {
      const refusal = mapEinladungRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    refresh();

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
 * Mails the minted link to the team's confirmed contact seats. **A second press, never part of the
 * mint**: the link is shown for copying first, and this is what puts it in an inbox.
 */
export async function mailEinladungAction(rawPayload: FLEinladungMailPayload): Promise<ActionResult> {
  return runAdminMutation("mailEinladungAction", { readOnly: false }, async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLEinladungMailPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const { team_id, saison_id, einladung_id, token } = validated.data;
    const memberships = await getTeamMemberships();
    const team = memberships.teams.find((candidate) => candidate.id === team_id) ?? null;
    const membership = team?.memberships.find((candidate) => candidate.saison_id === saison_id) ?? null;
    // The addresses are read HERE rather than carried in the payload: a mailbox a caller could name
    // would send a bearer credential wherever that caller chose.
    const kontakte = membership?.kontakte ?? null;

    // A panel left open while somebody else replaced or withdrew the link would mail a value that
    // opens nothing, and file the delivery record against a row that is closed.
    const gelesen = await getEinladung(team_id, saison_id);

    if (gelesen.einladung === null) {
      return {
        success: false,
        error: buildRefusal({
          reason: "Für dieses Team steht kein Link mehr offen",
          repair: "Lade die Seite neu und lege einen neuen Link an",
        }),
      };
    }

    if (gelesen.einladung.id !== einladung_id) {
      return {
        success: false,
        error: buildRefusal({
          reason: "Dieser Link ist nicht mehr der offene Link dieses Teams",
          repair: "Lade die Seite neu und lege einen neuen Link an",
        }),
      };
    }

    if (kontakte === null) {
      return {
        success: false,
        error: buildRefusal({
          reason: "Für dieses Team sind in dieser Saison keine Kontaktdaten hinterlegt",
          repair: "Trage die Kontakte ein, oder gib den Link von Hand weiter",
          where: "Kontakte",
        }),
      };
    }

    const empfaenger = bestaetigteEmpfaenger(kontakte);

    if (empfaenger.length === 0) {
      return {
        success: false,
        error: buildRefusal({
          reason: "Keine Kontaktperson dieses Teams hat ihre Daten bisher selbst bestätigt",
          repair: "Warte auf eine Bestätigung, oder gib den Link von Hand weiter",
        }),
      };
    }

    const origin = new URL(frontend_config.AUTH_URL).origin;
    const outcome = await sendZielMail({
      operation: "mailEinladungAction",
      // This press mints nothing, so two presses compose the same body and the second would mail
      // the link twice. A fresh mint answers a fresh `zielId`, which keeps the next link's message
      // its own.
      auftrag: { ziel: "einladung", zielId: einladung_id, anlass: "einladung", idempotenzTag: getGermanTodayStr() },
      recipients: empfaenger.map((seat) => seat.email),
      buildMail: () =>
        // The token is the CALLER's to name: only a hash is stored, so nothing checks it against
        // `einladung_id`. Worst case is an administrator mailing their own team a dead link, which
        // the two-press shape is worth.
        buildEinladungEmail({
          teamName: team?.name ?? "",
          saisonId: saison_id,
          origin: origin,
          link: einladungsLink(origin, token),
        }),
    });

    // BELOW the send, alone among this slice's actions: the delivery record is the only thing this
    // press writes, so a refresh above it would show the panel the state before the send.
    refresh();

    // A withheld send is this deployment rather than the mailbox, as `app/api/registrierung/route.ts`
    // reads it: outside production every address is withheld, and a refusal here would offer a
    // retry that cannot succeed.
    if (outcome.delivered.length === 0 && outcome.withheld.length === 0) {
      return {
        success: false,
        error: buildRefusal({ reason: "Die E-Mail konnte nicht gesendet werden", repair: "Versuche es erneut" }),
      };
    }

    return {
      success: true,
      message: outcome.delivered.length === 0 ? ZURUECKGEHALTEN : adressenSatz(outcome.delivered.length, empfaenger.length),
    };
  });
}

/** Closes the team's live link. Nothing reverses it: the next link is a fresh mint with a fresh value. */
export async function deleteEinladungAction(rawPayload: FLEinladungKeyPayload): Promise<ActionResult> {
  return runAdminMutation("deleteEinladungAction", { readOnly: false }, async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLEinladungKeyPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    try {
      await deleteEinladung(validated.data);
    } catch (error) {
      const refusal = mapEinladungRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    refresh();

    return { success: true, message: "Der Link öffnet ab sofort nichts mehr." };
  });
}

/**
 * Who the bulk send would write to, and why it would pass each of the others over. **Read-only**: it
 * reports what the press would do and writes nothing, as the fixture save's dry run does
 * (`fl_frontend/src/features/spiele/actions.ts :: previewAdminSpielDataAction`).
 */
export async function previewEinladungVersandAction(
  rawPayload: FLEinladungVersandPayload,
): Promise<QueryResult<{ zeilen: readonly FLEinladungVersandVorschauZeile[] }>> {
  return runAdminMutation("previewEinladungVersandAction", { readOnly: true }, async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

    const validated = FLEinladungVersandPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    let vorschau;
    try {
      // `?? false` for the endpoint's own default: the payload mirrors a request that may omit the
      // key, and this read has to name a value either way to describe the press it precedes.
      vorschau = await getEinladungVersandVorschau(validated.data.id, validated.data.erneut ?? false);
    } catch (error) {
      const refusal = mapEinladungRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    return { success: true, zeilen: vorschau.zeilen };
  });
}

/**
 * One press for every admitted team of the season. **The message is composed here because
 * nothing behind the API sends mail**: the endpoint decides who is written to, over the rule the
 * preview read.
 */
export async function postEinladungVersandAction(
  rawPayload: FLEinladungVersandPayload,
): Promise<ActionResult<{ zeilen: readonly EinladungVersandErgebnis[] }>> {
  return runAdminMutation("postEinladungVersandAction", { readOnly: false }, async () => {
    if (!(await getAdminSession())) {
      return { success: false, error: ADMIN_FORBIDDEN };
    }

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

    refresh();

    const origin = new URL(frontend_config.AUTH_URL).origin;
    const zeilen: EinladungVersandErgebnis[] = [];

    /* One team after another: the provider allows 10 requests a second per account (read at
       https://resend.com/docs/api-reference/rate-limit.md on 2026-09-21, which answers 429 over
       it), and a season of sixteen clubs fanned out at once would ask for about forty-eight. */
    for (const zeile of versandOperation.zeilen) {
      const { team_id, team_name, uebersprungen, einladung_id, token, ersetzt_link, hatte_link } = zeile;

      if (uebersprungen !== null || einladung_id === null || token === null) {
        zeilen.push({
          team_id: team_id,
          team_name: team_name,
          uebersprungen: uebersprungen,
          // The endpoint's own values, never a constant here: false on every skip, and on a row of
          // unknown outcome the link that commit may have revoked.
          ersetzt_link: ersetzt_link,
          hatte_link: hatte_link,
          zugestellt: [],
          unerreichbar: [],
          zurueckgehalten: [],
        });
        continue;
      }

      const outcome = await sendZielMail({
        operation: "postEinladungVersandAction",
        // No idempotency key: this press MINTS for every team it answers a link value for, so a
        // second press carries a different link in the same envelope
        // (`fl_frontend/src/features/zustellung/notifications.ts :: zielIdempotenzSchluessel`).
        auftrag: { ziel: "einladung", zielId: einladung_id, anlass: "einladung" },
        // The addresses inside one team stay concurrent: three at most, and `sendZielMail` settles
        // them, so one refused mailbox cannot cost its siblings their message.
        recipients: zeile.empfaenger.map((seat) => seat.email),
        buildMail: () =>
          buildEinladungEmail({ teamName: team_name, saisonId: validated.data.id, origin: origin, link: einladungsLink(origin, token) }),
      });

      zeilen.push({
        team_id: team_id,
        team_name: team_name,
        uebersprungen: null,
        ersetzt_link: ersetzt_link,
        hatte_link: hatte_link,
        zugestellt: outcome.delivered,
        unerreichbar: outcome.unreachable,
        // Carried for the reason the single press reads it: outside production every address is
        // withheld, and a row that cannot tell the two apart names every one of them in danger red.
        zurueckgehalten: outcome.withheld,
      });
    }

    const gemailt = zeilen.filter((zeile) => zeile.zugestellt.length > 0).length;

    return {
      success: true,
      zeilen: zeilen,
      message: versandSatz(gemailt, zeilen.length),
    };
  });
}
