import "server-only";

import { frontend_config } from "@/core/config";
import { buildSchiedsrichterBestaetigungEmail } from "@/core/schiedsrichterEmail";
import { ZURUECKGEHALTEN } from "@/features/einladungen/meldungen";
import { linkVersandOf, sendZielMail } from "@/features/zustellung/notifications";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSchiedsrichterMint } from "@/core/generated/client/types";
import type { ZustellAnlass } from "@/features/bewerbungen/zustellung";
import type { LinkVersand } from "@/shared/utils/linkVersand";

// Outside `actions.ts`, which is `"use server"` and whose every export is a callable endpoint: exported
// there, this would mail a link to whatever address a caller hands it, past every guard.
/**
 * Never thrown from: the block is written and the token spent by the time this runs, so a caller
 * told otherwise would report a mint that happened as one that did not.
 */
export async function mailSchiedsrichterLink({
  operation,
  schiedsrichterId,
  email,
  mint,
  anlass,
}: {
  operation: string;
  schiedsrichterId: string;
  email: string;
  mint: FLSchiedsrichterMint;
  anlass: ZustellAnlass;
}): Promise<LinkVersand> {
  return sendZielMail({
    operation: operation,
    // No `idempotenzTag`: the body carries a freshly minted token, and a key reused over a changed
    // body is refused rather than ignored.
    auftrag: { ziel: "schiedsrichter", zielId: schiedsrichterId, anlass: anlass },
    recipients: [email],
    buildMail: () =>
      buildSchiedsrichterBestaetigungEmail({
        // The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is not
        // production must not mail production links.
        origin: frontend_config.AUTH_URL,
        token: mint.token,
        fristText: formatSpielDatum(mint.frist),
      }),
  }).then(linkVersandOf);
}

/** What the administrator is told about the message their write sent, in the words `describeBewerbungMail` uses for a fan-out. */
export function describeLinkMail(email: string, versand: LinkVersand): string {
  if (versand === "gesendet") return `Der Bestätigungslink ging an ${email}.`;
  if (versand === "zurueckgehalten") return ZURUECKGEHALTEN;
  // Naming no address, as every barred send's report names none.
  if (versand === "gesperrt") return "Der Bestätigungslink ging nicht raus, weil die Adresse auf der Sperrliste steht.";

  return `Der Bestätigungslink konnte nicht an ${email} verschickt werden. Melde Dich selbst bei der Person.`;
}
