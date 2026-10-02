import "server-only";

import { frontend_config } from "@/core/config";
import { buildSchiedsrichterBestaetigungEmail } from "@/core/schiedsrichterEmail";
import { ZURUECKGEHALTEN } from "@/features/einladungen/meldungen";
import { sendZielMail } from "@/features/zustellung/notifications";
import { formatSpielDatum } from "@/shared/utils/format";

import { schiedsrichterVorname } from "./constants";

import type { ZustellAnlass } from "@/features/bewerbungen/zustellung";
import type { FLSchiedsrichterMint } from "./schemas";

/**
 * How the link's message ended. `zurueckgehalten` is a deployment that mails nothing filing it
 * (`fl_frontend/src/core/mail.ts :: MailWithheldError`): neither sent nor a failure to warn about.
 */
export type LinkVersand = "gesendet" | "zurueckgehalten" | "fehlgeschlagen";

// Outside `actions.ts`, which is `"use server"` and whose every export is a callable endpoint: the
// undo route mints a link too, and a helper it could not import would leave that token unmailed.
/**
 * Never thrown from: the block is written and the token spent by the time this runs, so a caller
 * told otherwise would report a mint that happened as one that did not.
 */
export async function mailSchiedsrichterLink({
  operation,
  schiedsrichterId,
  email,
  name,
  mint,
  anlass,
}: {
  operation: string;
  schiedsrichterId: string;
  email: string;
  name: string | null;
  mint: FLSchiedsrichterMint;
  anlass: ZustellAnlass;
}): Promise<LinkVersand> {
  const { delivered, withheld } = await sendZielMail({
    operation: operation,
    // No `idempotenzTag`: the body carries a freshly minted token, and a key reused over a changed
    // body is refused rather than ignored.
    auftrag: { ziel: "schiedsrichter", zielId: schiedsrichterId, anlass: anlass },
    recipients: [email],
    buildMail: () =>
      buildSchiedsrichterBestaetigungEmail({
        // The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is not
        // production must not mail production links (`docs/frontend/spec.md :: I186`).
        origin: frontend_config.AUTH_URL,
        vorname: schiedsrichterVorname(name) ?? "",
        token: mint.token,
        fristText: formatSpielDatum(mint.frist),
      }),
  });

  if (delivered.length > 0) return "gesendet";

  return withheld.length > 0 ? "zurueckgehalten" : "fehlgeschlagen";
}

/** What the administrator is told about the message their write sent, in the words `describeBewerbungMail` uses for a fan-out. */
export function describeLinkMail(email: string, versand: LinkVersand): string {
  if (versand === "gesendet") return `Der Bestätigungslink ging an ${email}.`;
  if (versand === "zurueckgehalten") return ZURUECKGEHALTEN;

  return `Der Bestätigungslink konnte nicht an ${email} zugestellt werden. Melde Dich selbst bei der Person.`;
}
