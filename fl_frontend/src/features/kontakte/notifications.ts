import "server-only";

import { frontend_config } from "@/core/config";
import { APIBadStatusError, APIMalformedDataError, APINetworkError } from "@/core/errors";
import { buildKontaktBestaetigungEmail } from "@/core/kontaktEmail";
import { logger } from "@/core/logging";
import { rollenText } from "@/features/bewerbungen/notifications";
import { kontaktZeile } from "@/features/kontakte/utils";
import { getAdminSaisons } from "@/features/saisons/queries";
import { describeLinkMail } from "@/features/schiedsrichter/notifications";
import { getTeamMemberships } from "@/features/teams/queries";
import { sendZielMail } from "@/features/zustellung/notifications";
import { formatSpielDatum } from "@/shared/utils/format";

import type { KontaktZeile } from "@/core/kontaktEmail";
import type { ZustellAnlass } from "@/features/bewerbungen/zustellung";
import type { LinkVersand } from "@/features/schiedsrichter/notifications";
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
  zeile,
}: {
  operation: string;
  /** The season row the message is about, which its delivery record is kept against. */
  saisonTeamId: string;
  saisonId: string;
  mint: FLKontaktMint;
  anlass: ZustellAnlass;
  /** The row's state the mint was made in, which fixes the page its link opens (`leseKontaktZeile`). */
  zeile: KontaktZeile;
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
        zeile: zeile,
      }),
  });

  if (delivered.length > 0) return "gesendet";
  if (gesperrt > 0) return "gesperrt";

  return withheld.length > 0 ? "zurueckgehalten" : "fehlgeschlagen";
}

/**
 * The state of the row a write minted on, which the mint does not answer. Read after the write and only
 * where it minted, so a write minting nothing reads nothing. Never thrown from.
 */
export async function leseKontaktZeile({ team_id, saison_id }: { team_id: string; saison_id: string }): Promise<KontaktZeile> {
  try {
    const [{ teams }, { saisons }] = await Promise.all([getTeamMemberships(), getAdminSaisons()]);
    const saison = saisons.find(({ id }) => id === saison_id);
    const membership = teams.find(({ id }) => id === team_id)?.memberships.find((candidate) => candidate.saison_id === saison_id);

    return saison === undefined || membership === undefined ? "offen" : kontaktZeile(saison.status, membership.austritt);
  } catch (error) {
    // The link is minted by now, and a thrown read would report a mint that happened as one that did
    // not. The open row's wording instead: on a closed row its page says itself that it takes no confirmation.
    logger.error("kontakt.zeile_ungelesen", undefined, {
      error_code:
        error instanceof APIBadStatusError || error instanceof APINetworkError || error instanceof APIMalformedDataError
          ? error.code
          : "FE-ACT-001",
      name: error instanceof Error ? error.name : undefined,
    });

    return "offen";
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
