import "server-only";

import { frontend_config } from "@/core/config";
import { mailboxKey } from "@/core/emailAddress";
import { buildKontaktBestaetigungEmail } from "@/core/kontaktEmail";
import { rollenText } from "@/features/bewerbungen/notifications";
import { describeLinkMail } from "@/features/schiedsrichter/notifications";
import { sendZielMail } from "@/features/zustellung/notifications";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLKontaktRolle } from "@/features/bewerbungen/schemas";
import type { ZustellAnlass } from "@/features/bewerbungen/zustellung";
import type { LinkVersand } from "@/features/schiedsrichter/notifications";
import type { FLSaisonTeamKontakte } from "@/features/teams/schemas";
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

  const { delivered, withheld, gesperrt } = await sendZielMail({
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
      }),
  });

  if (delivered.length > 0) return "gesendet";
  if (gesperrt > 0) return "gesperrt";

  return withheld.length > 0 ? "zurueckgehalten" : "fehlgeschlagen";
}

/** One mint's message and how it ended. */
export type KontaktVersand = { email: string; versand: LinkVersand };

/**
 * What the administrator is told about every link a write minted and every seat the ban list kept
 * one from, in `describeLinkMail`'s words. `null` where the write minted nothing and barred nobody.
 */
export function describeKontaktVersand(
  versendet: readonly KontaktVersand[],
  gesperrt: readonly FLKontaktRolle[],
  kontakte: FLSaisonTeamKontakte | null,
): string | null {
  const saetze =
    versendet.length > 1 && versendet.every(({ versand }) => versand === "gesendet")
      ? [`Die Bestätigungslinks gingen an ${String(versendet.length)} Personen.`]
      : versendet.map(({ email, versand }) => describeLinkMail(email, versand));

  // One sentence per barred PERSON: a paired Trainer is two seats of one address, and the sentence
  // names no address either way (`docs/frontend/spec.md :: I542`).
  const gesperrtePersonen = new Set(gesperrt.map((rolle) => mailboxKey(kontakte?.[rolle]?.email ?? rolle)));
  if (gesperrtePersonen.size === 1) saetze.push(describeLinkMail("", "gesperrt"));
  if (gesperrtePersonen.size > 1) saetze.push("Die Bestätigungslinks gingen nicht raus, weil die Adressen auf der Sperrliste stehen.");

  // Each sentence once: two withheld sends say the same deployment fact twice otherwise.
  const einmal = [...new Set(saetze)];

  return einmal.length === 0 ? null : einmal.join(" ");
}
