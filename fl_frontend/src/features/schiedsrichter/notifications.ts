import "server-only";

import { buildAdresswechselEmail, buildAdresswechselHinweisEmail, buildAdresswechselWirksamEmail } from "@/core/adresswechselEmail";
import { frontend_config } from "@/core/config";
import { logger } from "@/core/logging";
import { sendMail } from "@/core/mail";
import { runAnsweringOwnCut } from "@/core/requestScope";
import { buildSchiedsrichterBestaetigungEmail } from "@/core/schiedsrichterEmail";
import { versandAusfallOf } from "@/core/versandAusfall";
import { ZURUECKGEHALTEN } from "@/features/einladungen/meldungen";
import { linkVersandOf, sendZielMail } from "@/features/zustellung/notifications";
import { formatSpielDatum } from "@/shared/utils/format";

import type { ZustellAnlass } from "@/features/bewerbungen/zustellung";
import type { FLAdresswechselMitteilung } from "@/features/spieler/schemas";
import type { AdresswechselVersand, HinweisVersand, LinkVersand } from "@/shared/utils/linkVersand";
import type { FLSchiedsrichterAdresswechselMint, FLSchiedsrichterMint } from "./schemas";

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
        // production must not mail production links (`docs/frontend/spec.md :: I186`).
        origin: frontend_config.AUTH_URL,
        token: mint.token,
        fristText: formatSpielDatum(mint.frist),
      }),
  }).then(linkVersandOf);
}

/**
 * Never thrown from: the block is written and the tokens spent by now, and a caller told otherwise
 * reports a mint that happened as failed. A message goes only for a token the mint answered: no link
 * before an approval, no notice on a re-send, whose stop link already sits in that mailbox.
 */
export async function mailSchiedsrichterAdresswechsel({
  operation,
  schiedsrichterId,
  mint,
  anlass,
}: {
  operation: string;
  schiedsrichterId: string;
  mint: FLSchiedsrichterAdresswechselMint;
  anlass: ZustellAnlass;
}): Promise<AdresswechselVersand> {
  const { token, stopp_token: stoppToken } = mint;
  const [link, hinweis] = await Promise.all([
    token === null
      ? null
      : sendZielMail({
          operation: operation,
          // No `idempotenzTag`: every send carries a freshly minted token, and a key reused over a changed
          // body is refused rather than ignored.
          auftrag: { ziel: "schiedsrichter_adresswechsel", zielId: schiedsrichterId, anlass: anlass },
          // The address the MINT names, never the one an administrator typed: only the mint's own
          // transaction can say which mailbox the credential was made for.
          recipients: [mint.email],
          buildMail: () =>
            buildAdresswechselEmail({
              // The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is not
              // production must not mail production links (`docs/frontend/spec.md :: I186`).
              origin: frontend_config.AUTH_URL,
              art: "schiedsrichter",
              token: token,
              weg: mint.weg,
              gueltigBis: mint.gueltig_bis,
            }),
        }).then(linkVersandOf),
    stoppToken === null
      ? null
      : sendeHinweis(
          mint.bisherige_email,
          buildAdresswechselHinweisEmail({
            origin: frontend_config.AUTH_URL,
            art: "schiedsrichter",
            stoppToken: stoppToken,
            weg: mint.weg,
            gueltigBis: mint.gueltig_bis,
            vorname: mint.vorname,
          }),
          "schiedsrichter.adresshinweis_failed",
          operation,
        ),
  ]);

  return { weg: mint.weg, link: link, hinweis: hinweis };
}

/** The completion notice to the replaced address, best effort as the notice is: a failure is logged, never retried. */
export async function mailSchiedsrichterAdresswechselWirksam({
  operation,
  mitteilung,
}: {
  operation: string;
  mitteilung: FLAdresswechselMitteilung;
}): Promise<HinweisVersand> {
  return sendeHinweis(
    mitteilung.bisherige_email,
    buildAdresswechselWirksamEmail({ origin: frontend_config.AUTH_URL, vorname: mitteilung.vorname, zeitpunkt: new Date() }),
    "schiedsrichter.adresswirksam_failed",
    operation,
  );
}

async function sendeHinweis(
  adresse: string,
  mail: { subject: string; html: string; text: string },
  ereignis: string,
  operation: string,
): Promise<HinweisVersand> {
  try {
    // Through the ban list like every message (`fl_frontend/src/core/mail.ts :: sendMail`), and
    // untagged: a delivery event about it is acknowledged and recorded nowhere. A cut or a lost answer here
    // is its own doubt, never the request's (`docs/frontend/spec.md :: I372`).
    await runAnsweringOwnCut(() => sendMail({ to: adresse, ...mail }));
    return "gesendet";
  } catch (error) {
    // The fan-out's own reading, so this lone send ends in the words a link mail's do.
    const ausfall = versandAusfallOf(error);
    if (ausfall === "gesperrt" || ausfall === "zurueckgehalten") return ausfall;
    // Name only, never the error, which carries the address (`docs/logging/spec.md :: L9`).
    logger.error(ereignis, undefined, {
      error_code: "FE-MAIL-002",
      name: error instanceof Error ? error.name : undefined,
      operation: operation,
    });
    return ausfall;
  }
}

/** What the administrator is told about the message their write sent, in the words `describeBewerbungMail` uses for a fan-out. */
export function describeLinkMail(email: string, versand: LinkVersand): string {
  if (versand === "gesendet") return `Der Bestätigungslink ging an ${email}.`;
  if (versand === "zurueckgehalten") return ZURUECKGEHALTEN;
  // Naming no address, as every barred send's report names none (`docs/frontend/spec.md :: I542`).
  if (versand === "gesperrt") return "Der Bestätigungslink ging nicht raus, weil die Adresse auf der Sperrliste steht.";

  return `Der Bestätigungslink konnte nicht an ${email} verschickt werden. Melde Dich selbst bei der Person.`;
}
