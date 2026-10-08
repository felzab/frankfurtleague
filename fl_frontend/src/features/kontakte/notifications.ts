import "server-only";

import { frontend_config } from "@/core/config";
import { buildKontaktBestaetigungEmail } from "@/core/kontaktEmail";
import { rollenText } from "@/features/bewerbungen/notifications";
import { describeLinkMail } from "@/features/schiedsrichter/notifications";
import { linkVersandOf, sendZielMail } from "@/features/zustellung/notifications";
import { formatSpielDatum } from "@/shared/utils/format";

import type { ZustellAnlass } from "@/features/bewerbungen/zustellung";
import type { LinkVersand } from "@/features/zustellung/notifications";
import type { FLKontaktMint } from "./schemas";

// Outside `actions.ts`, which is `"use server"` and whose every export is a callable endpoint: the
// undo route mints links too, and a helper it could not import would leave those tokens unmailed.
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
        vorname: mint.vorname,
        rollenText: rollenText(mint.rollen),
        schule: mint.schule,
        saisonId: saisonId,
        token: mint.token,
        fristText: formatSpielDatum(mint.frist),
        zeile: mint.zeile,
      }),
  }).then(linkVersandOf);
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
