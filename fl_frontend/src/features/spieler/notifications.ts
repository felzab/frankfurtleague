import "server-only";

import { ADRESSWECHSEL_WARTEZEIT_DAUER, adresswechselZeitpunkt } from "@/core/adresswechsel";
import { buildAdresswechselEmail, buildAdresswechselHinweisEmail, buildAdresswechselWirksamEmail } from "@/core/adresswechselEmail";
import { frontend_config } from "@/core/config";
import { logger } from "@/core/logging";
import { sendMail } from "@/core/mail";
import { runAnsweringOwnCut } from "@/core/requestScope";
import { versandAusfallOf } from "@/core/versandAusfall";
import { ZURUECKGEHALTEN } from "@/features/einladungen/meldungen";
import { linkVersandOf, sendZielMail } from "@/features/zustellung/notifications";

import type { ZustellAnlass } from "@/features/bewerbungen/zustellung";
import type { AdresswechselVersand, HinweisVersand } from "@/shared/utils/linkVersand";
import type { FLAdresswechselMitteilung, FLSpielerAdresswechselMint } from "./schemas";

// Outside `actions.ts`, which is `"use server"` and whose every export is a callable endpoint: exported
// there, this would mail a link to whatever address a caller hands it, past every guard.
/**
 * Never thrown from, the tokens being spent by now. A message goes only for a token the mint answered:
 * no link before an approval, no notice on a re-send, whose stop link already sits in that mailbox.
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
}): Promise<AdresswechselVersand> {
  const { token, stopp_token: stoppToken } = mint;
  const [link, hinweis] = await Promise.all([
    token === null
      ? null
      : sendZielMail({
          operation: operation,
          // No `idempotenzTag`: every send carries a freshly minted token, and a key reused over a changed
          // body is refused rather than ignored.
          auftrag: { ziel: "spieler_adresswechsel", zielId: spielerId, anlass: anlass },
          // The address the MINT names, never the one an administrator typed: only the mint's own
          // transaction can say which mailbox the credential was made for.
          recipients: [mint.email],
          buildMail: () =>
            buildAdresswechselEmail({
              // The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is not
              // production must not mail production links (`docs/frontend/spec.md :: I186`).
              origin: frontend_config.AUTH_URL,
              art: "spieler",
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
            art: "spieler",
            stoppToken: stoppToken,
            weg: mint.weg,
            gueltigBis: mint.gueltig_bis,
            vorname: mint.vorname,
          }),
          "spieler.adresshinweis_failed",
          operation,
        ),
  ]);

  return { weg: mint.weg, link: link, hinweis: hinweis };
}

/** The completion notice to the replaced address, best effort as the notice is: a failure is logged, never retried. */
export async function mailSpielerAdresswechselWirksam({
  operation,
  mitteilung,
}: {
  operation: string;
  mitteilung: FLAdresswechselMitteilung;
}): Promise<HinweisVersand> {
  return sendeHinweis(
    mitteilung.bisherige_email,
    buildAdresswechselWirksamEmail({ origin: frontend_config.AUTH_URL, vorname: mitteilung.vorname, zeitpunkt: new Date() }),
    "spieler.adresswirksam_failed",
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

/**
 * What the administrator is told of a change's messages, both lanes alike, naming the new address alone.
 * A failed notice is said: its stop link is the address on file's one way to refuse the change.
 */
export function describeAdresswechselMail(
  mint: Pick<FLSpielerAdresswechselMint, "email" | "gueltig_bis" | "adresse_belegt">,
  versand: AdresswechselVersand,
): string {
  const { email } = mint;
  const link =
    versand.link === null
      ? `Die bisherige Adresse ist gebeten, die Änderung in ihrem Konto freizugeben, bis ${adresswechselZeitpunkt(mint.gueltig_bis)}. Erst danach geht der Link an die neue.`
      : versand.link === "gesendet"
        ? `Der Link zur Bestätigung der neuen Adresse ging an ${email}. Bis zur Bestätigung gilt die bisherige.`
        : versand.link === "zurueckgehalten"
          ? ZURUECKGEHALTEN
          : // Naming no address, as every barred send's report names none (`docs/frontend/spec.md :: I542`).
            versand.link === "gesperrt"
            ? "Der Link zur neuen Adresse ging nicht raus, weil sie auf der Sperrliste steht."
            : `Der Link zur Bestätigung konnte nicht an ${email} verschickt werden. Melde Dich selbst bei der Person.`;
  const wartezeit = versand.weg === "wartezeit" ? ` Die neue gilt erst ${ADRESSWECHSEL_WARTEZEIT_DAUER} nach ihrer Bestätigung.` : "";
  const hinweis =
    versand.hinweis === "ungewiss"
      ? " Ob der Hinweis an die bisherige Adresse angekommen ist, ist unklar. Sag der Person selbst Bescheid."
      : versand.hinweis === "fehlgeschlagen"
        ? " Der Hinweis an die bisherige Adresse ging nicht raus. Sag der Person selbst Bescheid."
        : "";
  // The administrator's warning alone: the person's own start answers alike whatever the address holds.
  const belegt = mint.adresse_belegt
    ? " Unter der neuen Adresse stehen schon Einträge bei der Liga. Bestätigt die Person den Link, gehören danach alle zu einer Anmeldung."
    : "";

  return `${link}${wartezeit}${hinweis}${belegt}`;
}
