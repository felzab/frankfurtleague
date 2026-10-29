import "server-only";

import { ADRESSWECHSEL_WARTEZEIT_DAUER } from "@/core/adresswechsel";
import {
  buildAdresswechselEmail,
  buildAdresswechselHinweisEmail,
  buildAdresswechselNichtWirksamEmail,
  buildAdresswechselWirksamEmail,
} from "@/core/adresswechselEmail";
import { carryAccount } from "@/core/auth";
import { frontend_config } from "@/core/config";
import { renderMail } from "@/core/emailShell";
import { formatZeitpunkt } from "@/core/format";
import { logger } from "@/core/logging";
import { sendMail } from "@/core/mail";
import { runAnsweringOwnCut } from "@/core/requestScope";
import { versandAusfallOf } from "@/core/versandAusfall";
import { ZURUECKGEHALTEN } from "@/features/einladungen/meldungen";
import { linkVersandOf, sendZielMail } from "@/features/zustellung/notifications";

import type { Mail } from "@/core/emailShell";
import type { ZustellAnlass } from "@/features/bewerbungen/zustellung";
import type { AdresswechselVersand, HinweisVersand } from "@/shared/utils/linkVersand";
import type { FLAdresswechselPostausgangZeile, FLAdresswechselVerwaltungMintResponse } from "./schemas";

/** What a start or a re-send minted, whichever tier answered it: the account page's start carries no `weg`, its own being `konto`. */
export type AdresswechselMint = Pick<
  FLAdresswechselVerwaltungMintResponse,
  "id" | "weg" | "token" | "stopp_token" | "gueltig_bis" | "email" | "bisherige_email" | "vorname"
>;

// Outside `actions.ts`, which is `"use server"` and whose every export is a callable endpoint: exported
// there, this would mail a link to whatever address a caller hands it, past every guard.
/**
 * Never thrown from, the tokens being spent by now. A message goes only for a token the mint answered:
 * no link before an approval, no notice on a re-send, whose stop link already sits in that mailbox.
 */
export async function mailAdresswechsel({
  operation,
  mint,
  anlass,
}: {
  operation: string;
  mint: AdresswechselMint;
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
          auftrag: { ziel: "adresswechsel", zielId: mint.id, anlass: anlass },
          // The address the MINT names, never the one an administrator typed: only the mint's own
          // transaction can say which mailbox the credential was made for.
          recipients: [mint.email],
          buildMail: () =>
            buildAdresswechselEmail({ origin: frontend_config.AUTH_URL, token: token, weg: mint.weg, gueltigBis: mint.gueltig_bis }),
        }).then(linkVersandOf),
    stoppToken === null
      ? null
      : sendeHinweis(
          mint.bisherige_email,
          buildAdresswechselHinweisEmail({
            origin: frontend_config.AUTH_URL,
            stoppToken: stoppToken,
            weg: mint.weg,
            gueltigBis: mint.gueltig_bis,
            vorname: mint.vorname ?? "",
          }),
          "adresswechsel.hinweis_failed",
          operation,
        ),
  ]);

  return { weg: mint.weg, link: link, hinweis: hinweis };
}

/**
 * What an effect owes after its commit: the replaced address's account moved, then its completion notice. Never throws;
 * answers whether both are done with, so the outbox keeps a failed one, and a move run again finds no account left.
 */
export async function adresswechselWirksam({
  operation,
  mitteilung,
}: {
  operation: string;
  mitteilung: Pick<FLAdresswechselPostausgangZeile, "bisherige_email" | "email" | "vorname" | "weg">;
}): Promise<boolean> {
  const { bisherige_email: bisherige } = mitteilung;
  if (bisherige === null) return true;

  // A change made because the address on file is lost carries nothing from it: its holder may be a stranger who signed
  // in there during the waiting time, and their sessions and passkeys must not follow the person.
  const traegt = mitteilung.weg !== "wartezeit";
  if (traegt) {
    try {
      const umzug = await carryAccount(bisherige, mitteilung.email);
      if (umzug === "belegt") logger.warn("adresswechsel.konto_nicht_umgezogen", { error_code: "FE-AUTH-013", grund: "belegt", operation });
    } catch (error) {
      // Name only, never the error, which carries an address.
      logger.error("adresswechsel.konto_nicht_umgezogen", undefined, {
        error_code: "FE-AUTH-013",
        name: error instanceof Error ? error.name : undefined,
        operation: operation,
      });
      // Not done with, the notice unsent: the next claim moves the account and then tells the old address, which a
      // notice sent now would have told of an account still waiting there.
      return false;
    }
  }

  const versand = await sendeHinweis(
    bisherige,
    // Greeting nobody where the backend sends no name: the lost-mailbox way's old mailbox may be a stranger's.
    buildAdresswechselWirksamEmail({ origin: frontend_config.AUTH_URL, vorname: mitteilung.vorname ?? "", zeitpunkt: new Date() }),
    "adresswechsel.wirksam_failed",
    operation,
  );
  return versand !== "fehlgeschlagen";
}

/**
 * The new mailbox's notice of a due change the pass refused, through the ban list like every message: a barred address
 * hears nothing. Answers whether it is done with, as `adresswechselWirksam` does.
 */
export async function mailAdresswechselNichtWirksam({ operation, email }: { operation: string; email: string }): Promise<boolean> {
  const versand = await sendeHinweis(
    email,
    buildAdresswechselNichtWirksamEmail({ origin: frontend_config.AUTH_URL }),
    "adresswechsel.nicht_wirksam_failed",
    operation,
  );
  return versand !== "fehlgeschlagen";
}

async function sendeHinweis(adresse: string, mail: Mail, ereignis: string, operation: string): Promise<HinweisVersand> {
  try {
    // Through the ban list like every message (`fl_frontend/src/core/mail.ts :: sendMail`), and
    // untagged: a delivery event about it is acknowledged and recorded nowhere. A cut or a lost answer here
    // is its own doubt, never the request's.
    await runAnsweringOwnCut(() => sendMail({ to: adresse, ...renderMail(mail) }));
    return "gesendet";
  } catch (error) {
    // The fan-out's own reading, so this lone send ends in the words a link mail's do.
    const ausfall = versandAusfallOf(error);
    if (ausfall === "gesperrt" || ausfall === "zurueckgehalten") return ausfall;
    // Name only, never the error, which carries the address.
    logger.error(ereignis, undefined, {
      error_code: "FE-MAIL-002",
      name: error instanceof Error ? error.name : undefined,
      operation: operation,
    });
    return ausfall;
  }
}

/**
 * What the administrator is told of the messages, naming only the new address. A failed notice is said: its stop link
 * is the address on file's one refusal.
 */
export function describeAdresswechselMail(mint: Pick<AdresswechselMint, "email" | "gueltig_bis">, versand: AdresswechselVersand): string {
  const { email } = mint;
  const link =
    versand.link === null
      ? describeAnfrage(versand.hinweis, mint.gueltig_bis)
      : versand.link === "gesendet"
        ? `Der Link zur Bestätigung der neuen Adresse ging an ${email}. Bis zur Bestätigung gilt die bisherige.`
        : versand.link === "zurueckgehalten"
          ? ZURUECKGEHALTEN
          : // Naming no address, as every barred send's report names none.
            versand.link === "gesperrt"
            ? "Der Link zur neuen Adresse ging nicht raus, weil sie auf der Sperrliste steht."
            : `Der Link zur Bestätigung konnte nicht an ${email} verschickt werden. Melde Dich selbst bei der Person.`;
  const wartezeit = versand.weg === "wartezeit" ? ` Die neue gilt erst ${ADRESSWECHSEL_WARTEZEIT_DAUER} nach ihrer Bestätigung.` : "";
  // With no link the notice is the request itself, which `describeAnfrage` has already worded.
  const hinweis =
    versand.link === null
      ? ""
      : versand.hinweis === "ungewiss"
        ? " Ob der Hinweis an die bisherige Adresse angekommen ist, ist unklar. Sag der Person selbst Bescheid."
        : versand.hinweis === "fehlgeschlagen"
          ? " Der Hinweis an die bisherige Adresse ging nicht raus. Sag der Person selbst Bescheid."
          : "";

  return `${link}${wartezeit}${hinweis}`;
}

/** The request to the address on file, the one message a change waiting on its approval sends: worded by how it ended. */
function describeAnfrage(hinweis: HinweisVersand | null, gueltigBis: string): string {
  const bis = formatZeitpunkt(gueltigBis);
  switch (hinweis) {
    case "gesendet":
      return `Die bisherige Adresse ist gebeten, die Änderung in ihrem Konto freizugeben, bis ${bis}. Erst danach geht der Link an die neue.`;
    case "zurueckgehalten":
      return ZURUECKGEHALTEN;
    // Naming no address: the ban list holds the address on file.
    case "gesperrt":
      return "Die Anfrage an die bisherige Adresse ging nicht raus, weil sie auf der Sperrliste steht. Verwirf die Änderung.";
    case "ungewiss":
      return "Ob die Anfrage an die bisherige Adresse angekommen ist, ist unklar. Sag der Person selbst Bescheid.";
    default:
      return `Die Anfrage an die bisherige Adresse ging nicht raus. Sag der Person selbst Bescheid, damit sie die Änderung bis ${bis} in ihrem Konto freigibt.`;
  }
}
