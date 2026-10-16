import "server-only";

import { frontend_config } from "@/core/config";
import { logger } from "@/core/logging";
import { sendMail } from "@/core/mail";
import { runAnsweringOwnCut } from "@/core/requestScope";
import { buildSpielerAdresswechselEmail, buildSpielerAdresswechselHinweisEmail } from "@/core/spielerEmail";
import { versandAusfallOf } from "@/core/versandAusfall";
import { ZURUECKGEHALTEN } from "@/features/einladungen/meldungen";
import { linkVersandOf, sendZielMail } from "@/features/zustellung/notifications";
import { formatSpielDatum } from "@/shared/utils/format";

import type { ZustellAnlass } from "@/features/bewerbungen/zustellung";
import type { HinweisVersand, LinkVersand } from "@/shared/utils/linkVersand";
import type { FLSpielerAdresswechselMint } from "./schemas";

/** How an address change's two messages ended: the link to the new address and the notice to the stored one. */
export type SpielerAdresswechselVersand = { link: LinkVersand; hinweis: HinweisVersand };

// Outside `actions.ts`, which is `"use server"` and whose every export is a callable endpoint: exported
// there, this would mail a link to whatever address a caller hands it, past every guard.
/**
 * Never thrown from: the block is written and the token spent by now, and a caller told otherwise
 * reports a mint that happened as failed. The notice records no delivery state: its bounce would
 * mark the link's record.
 */
export async function mailSpielerAdresswechsel({
  operation,
  spielerId,
  mint,
  anlass,
}: {
  operation: string;
  spielerId: string;
  mint: FLSpielerAdresswechselMint;
  anlass: ZustellAnlass;
}): Promise<SpielerAdresswechselVersand> {
  const [link, hinweis] = await Promise.all([
    sendZielMail({
      operation: operation,
      // No `idempotenzTag`: every send carries a freshly minted token, and a key reused over a changed
      // body is refused rather than ignored.
      auftrag: { ziel: "spieler_adresswechsel", zielId: spielerId, anlass: anlass },
      // The address the MINT names, never the one an administrator typed: only the mint's own
      // transaction can say which mailbox the credential was made for.
      recipients: [mint.email],
      buildMail: () =>
        buildSpielerAdresswechselEmail({
          // The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is not
          // production must not mail production links (`docs/frontend/spec.md :: I186`).
          origin: frontend_config.AUTH_URL,
          token: mint.token,
          fristText: formatSpielDatum(mint.frist),
        }),
    }).then(linkVersandOf),
    sendeHinweis(mint.bisherige_email, mint.vorname, operation),
  ]);

  return { link: link, hinweis: hinweis };
}

async function sendeHinweis(adresse: string, vorname: string, operation: string): Promise<HinweisVersand> {
  try {
    // Through the ban list like every message (`fl_frontend/src/core/mail.ts :: sendMail`), and
    // untagged: a delivery event about it is acknowledged and recorded nowhere. A cut or a lost answer here
    // is its own doubt, never the request's (`docs/frontend/spec.md :: I372`).
    await runAnsweringOwnCut(() =>
      sendMail({ to: adresse, ...buildSpielerAdresswechselHinweisEmail({ origin: frontend_config.AUTH_URL, vorname: vorname }) }),
    );
    return "gesendet";
  } catch (error) {
    // The fan-out's own reading, so this lone send ends in the words a link mail's do.
    const ausfall = versandAusfallOf(error);
    if (ausfall === "gesperrt" || ausfall === "zurueckgehalten") return ausfall;
    // Name only, never the error, which carries the address (`docs/logging/spec.md :: L9`).
    logger.error("spieler.adresshinweis_failed", undefined, {
      error_code: "FE-MAIL-002",
      name: error instanceof Error ? error.name : undefined,
      operation: operation,
    });
    return ausfall;
  }
}

/** What the administrator is told about an address change's two messages, naming the new address and never the stored one. */
export function describeSpielerAdresswechselMail(email: string, versand: SpielerAdresswechselVersand): string {
  const link =
    versand.link === "gesendet"
      ? `Der Link zur Bestätigung der neuen Adresse ging an ${email}. Bis zur Bestätigung gilt die bisherige.`
      : versand.link === "zurueckgehalten"
        ? ZURUECKGEHALTEN
        : // Naming no address, as every barred send's report names none (`docs/frontend/spec.md :: I542`).
          versand.link === "gesperrt"
          ? "Der Link zur neuen Adresse ging nicht raus, weil sie auf der Sperrliste steht."
          : `Der Link zur Bestätigung konnte nicht an ${email} verschickt werden. Melde Dich selbst bei der Person.`;
  // Said only where it did not go: the notice is a courtesy, and its arrival is not the administrator's to act on.
  const hinweis =
    versand.hinweis === "ungewiss"
      ? " Ob der Hinweis an die bisherige Adresse angekommen ist, ist unklar. Sag der Person selbst Bescheid."
      : versand.hinweis === "fehlgeschlagen"
        ? " Der Hinweis an die bisherige Adresse ging nicht raus. Sag der Person selbst Bescheid."
        : "";

  return `${link}${hinweis}`;
}
