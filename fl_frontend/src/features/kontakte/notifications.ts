import "server-only";

import { randomUUID } from "node:crypto";

import { frontend_config } from "@/core/config";
import { KONTAKT_ABGANG_HINWEIS, KONTAKT_ABGANG_TAG } from "@/core/kontaktAbgangTag";
import { buildKontaktAbgangEmail, buildKontaktBestaetigungEmail } from "@/core/kontaktEmail";
import { logger } from "@/core/logging";
import { sendMail } from "@/core/mail";
import { mailIdempotencyKey } from "@/core/mailIdempotencyKey";
import { versandAusfallOf } from "@/core/versandAusfall";
import { rollenText } from "@/features/bewerbungen/notifications";
import { describeLinkMail } from "@/features/schiedsrichter/notifications";
import { linkVersandOf, sendZielMail } from "@/features/zustellung/notifications";
import { formatSpielDatum } from "@/shared/utils/format";

import type { ZustellAnlass } from "@/features/bewerbungen/zustellung";
import type { LinkVersand } from "@/shared/utils/linkVersand";
import type { FLKontaktAbgang, FLKontaktMint } from "./schemas";

// Outside `actions.ts`, which is `"use server"` and whose every export is a callable endpoint: exported
// there, this would mail a link to whatever address a caller hands it, past every guard.
/**
 * Never thrown from: the seat's link is written and the token spent by the time this runs, so a caller
 * told otherwise would report a mint that happened as one that did not.
 */
export async function mailKontaktLink({
  operation,
  saisonTeamId,
  saisonId,
  mint,
  anlass,
}: {
  operation: string;
  /** The season row the message is about, which its delivery record is kept against. */
  saisonTeamId: string;
  saisonId: string;
  mint: FLKontaktMint;
  anlass: ZustellAnlass;
}): Promise<LinkVersand> {
  const [erste, ...weitere] = mint.rollen;
  // A mint naming no seat has nothing to record its delivery against, and the endpoint refuses that record.
  if (erste === undefined) return "fehlgeschlagen";

  return sendZielMail({
    operation: operation,
    // No `idempotenzTag`: the body carries a freshly minted token, and a key reused over a changed
    // body is refused rather than ignored.
    auftrag: { ziel: "kontakt", zielId: saisonTeamId, anlass: anlass, rollen: [erste, ...weitere] },
    // The address the MINT names, never one a caller sent: only the mint's own transaction can say
    // which mailbox the credential was made for.
    recipients: [mint.email],
    buildMail: () =>
      buildKontaktBestaetigungEmail({
        // The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is not
        // production must not mail production links (`docs/frontend/spec.md :: I186`).
        origin: frontend_config.AUTH_URL,
        rollenText: rollenText(mint.rollen),
        schule: mint.schule,
        saisonId: saisonId,
        token: mint.token,
        fristText: formatSpielDatum(mint.frist),
        zeile: mint.zeile,
      }),
  }).then(linkVersandOf);
}

/**
 * The notice to a mailbox a save took off the row, never thrown from: the save has landed. On the lane no record holds
 * (`fl_frontend/src/core/kontaktAbgangTag.ts`), since the seat's own delivery record now describes its next holder.
 */
export async function mailKontaktAbgang({
  operation,
  saisonId,
  abgang,
}: {
  operation: string;
  saisonId: string;
  abgang: FLKontaktAbgang;
}): Promise<void> {
  try {
    await sendMail({
      to: abgang.email,
      ...buildKontaktAbgangEmail({
        origin: frontend_config.AUTH_URL,
        rollenText: rollenText(abgang.rollen),
        schule: abgang.schule,
        saisonId: saisonId,
      }),
      tags: { [KONTAKT_ABGANG_TAG]: KONTAKT_ABGANG_HINWEIS },
      // Minted per call, which `deliver`'s retries reuse: a key held for the provider's 24 hours over the row and the day
      // would swallow the same removal undone and saved again.
      idempotencyKey: mailIdempotencyKey([KONTAKT_ABGANG_TAG, randomUUID()], abgang.email),
    });
  } catch (error) {
    // A barred or a withheld message is the mailer's own line, as on every lane.
    const ausfall = versandAusfallOf(error);
    if (ausfall === "gesperrt" || ausfall === "zurueckgehalten") return;
    // Name only, never the error: its message can carry the address (`docs/logging/spec.md :: L9`).
    logger.error("kontakt.abgang_failed", undefined, {
      error_code: "FE-MAIL-015",
      name: error instanceof Error ? error.name : undefined,
      operation: operation,
    });
  }
}

/** One mint's message and how it ended. */
export type KontaktVersand = { email: string; versand: LinkVersand };

/** What the administrator is told about every link a write minted, in `describeLinkMail`'s words. `null` where it minted nothing. */
export function describeKontaktVersand(versendet: readonly KontaktVersand[]): string | null {
  const saetze =
    versendet.length > 1 && versendet.every(({ versand }) => versand === "gesendet")
      ? [`Die Bestätigungslinks gingen an ${String(versendet.length)} Personen.`]
      : versendet.map(({ email, versand }) => describeLinkMail(email, versand));

  // Each sentence once: two withheld sends say the same deployment fact twice otherwise.
  const einmal = [...new Set(saetze)];

  return einmal.length === 0 ? null : einmal.join(" ");
}
