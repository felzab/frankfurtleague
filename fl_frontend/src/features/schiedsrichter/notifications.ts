import "server-only";

import { frontend_config } from "@/core/config";
import { logger } from "@/core/logging";
import { sendMail } from "@/core/mail";
import { markOutcomeUnknown } from "@/core/requestScope";
import {
  buildSchiedsrichterAdresswechselEmail,
  buildSchiedsrichterAdresswechselHinweisEmail,
  buildSchiedsrichterBestaetigungEmail,
} from "@/core/schiedsrichterEmail";
import { versandAusfallOf } from "@/core/versandAusfall";
import { ZURUECKGEHALTEN } from "@/features/einladungen/meldungen";
import { linkVersandOf, sendZielMail } from "@/features/zustellung/notifications";
import { formatSpielDatum } from "@/shared/utils/format";

import { schiedsrichterVorname } from "./constants";

import type { ZustellAnlass } from "@/features/bewerbungen/zustellung";
import type { LinkVersand } from "@/features/zustellung/notifications";
import type { FLSchiedsrichterAdresswechselMint, FLSchiedsrichterMint } from "./schemas";

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
  return sendZielMail({
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
  }).then(linkVersandOf);
}

/** How the two messages of an address change ended: the link to the new address and the notice to the stored one. */
export type AdresswechselVersand = { link: LinkVersand; hinweis: LinkVersand | null };

/**
 * Never thrown from, for `mailSchiedsrichterLink`'s reason. The notice goes out beside the link and
 * records no delivery state: the record its bounce would mark is the consent link's, whose message
 * this is not.
 */
export async function mailSchiedsrichterAdresswechsel({
  operation,
  schiedsrichterId,
  name,
  mint,
  anlass,
}: {
  operation: string;
  schiedsrichterId: string;
  name: string | null;
  mint: FLSchiedsrichterAdresswechselMint;
  anlass: ZustellAnlass;
}): Promise<AdresswechselVersand> {
  const vorname = schiedsrichterVorname(name) ?? "";
  const [link, hinweis] = await Promise.all([
    sendZielMail({
      operation: operation,
      // No `idempotenzTag`, for the consent link's reason: every send carries a freshly minted token.
      auftrag: { ziel: "schiedsrichter_adresswechsel", zielId: schiedsrichterId, anlass: anlass },
      recipients: [mint.email],
      buildMail: () =>
        buildSchiedsrichterAdresswechselEmail({
          origin: frontend_config.AUTH_URL,
          vorname: vorname,
          token: mint.token,
          fristText: formatSpielDatum(mint.frist),
        }),
    }).then(linkVersandOf),
    mint.bisherige_email === null ? Promise.resolve(null) : sendeHinweis(mint.bisherige_email, vorname, operation),
  ]);

  return { link: link, hinweis: hinweis };
}

async function sendeHinweis(adresse: string, vorname: string, operation: string): Promise<LinkVersand> {
  try {
    // Through the ban list like every message (`fl_frontend/src/core/mail.ts :: sendMail`), and
    // untagged: a delivery event about it is acknowledged and recorded nowhere.
    await sendMail({ to: adresse, ...buildSchiedsrichterAdresswechselHinweisEmail({ origin: frontend_config.AUTH_URL, vorname: vorname }) });
    return "gesendet";
  } catch (error) {
    // The fan-out's own reading, so this lone send ends in the words a link mail's do.
    const ausfall = versandAusfallOf(error);
    if (ausfall === "gesperrt" || ausfall === "zurueckgehalten") return ausfall;
    // A send that broke off unanswered may have landed, so the request is of unknown outcome, as the
    // fan-out marks it (`docs/frontend/spec.md :: I366`); reported as not sent, as `linkVersandOf` reports it.
    if (ausfall === "ungewiss") markOutcomeUnknown();
    // Name only, never the error, which carries the address (`docs/logging/spec.md :: L9`).
    logger.error("schiedsrichter.adresshinweis_failed", undefined, {
      error_code: "FE-MAIL-002",
      name: error instanceof Error ? error.name : undefined,
      operation: operation,
    });
    return "fehlgeschlagen";
  }
}

/** What the administrator is told about an address change's two messages, naming the new address and never the stored one. */
export function describeAdresswechselMail(email: string, versand: AdresswechselVersand): string {
  const link =
    versand.link === "gesendet"
      ? `Der Link zur Bestätigung der neuen Adresse ging an ${email}; bis zur Bestätigung gilt die bisherige.`
      : versand.link === "zurueckgehalten"
        ? ZURUECKGEHALTEN
        : versand.link === "gesperrt"
          ? "Der Link zur neuen Adresse ging nicht raus, weil sie auf der Sperrliste steht."
          : `Der Link zur Bestätigung konnte nicht an ${email} zugestellt werden. Melde Dich selbst bei der Person.`;
  // Said only where it did not go: the notice is a courtesy, and its arrival is not the administrator's to act on.
  const hinweis =
    versand.hinweis === "fehlgeschlagen" ? " Der Hinweis an die bisherige Adresse ging nicht raus; sag der Person selbst Bescheid." : "";

  return `${link}${hinweis}`;
}

/** What the administrator is told about the message their write sent, in the words `describeBewerbungMail` uses for a fan-out. */
export function describeLinkMail(email: string, versand: LinkVersand): string {
  if (versand === "gesendet") return `Der Bestätigungslink ging an ${email}.`;
  if (versand === "zurueckgehalten") return ZURUECKGEHALTEN;
  // Naming no address, as every barred send's report names none (`docs/frontend/spec.md :: I542`).
  if (versand === "gesperrt") return "Der Bestätigungslink ging nicht raus, weil die Adresse auf der Sperrliste steht.";

  return `Der Bestätigungslink konnte nicht an ${email} zugestellt werden. Melde Dich selbst bei der Person.`;
}
