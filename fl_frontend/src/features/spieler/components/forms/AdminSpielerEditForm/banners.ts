/**
 * SPIELER · every Hinweis the squad editor can raise, in one list
 *
 * One entry per situation, read by the rail and by the panel that also shows it inline — see the
 * club editor's `banners.ts` for why the two halves cannot be authored separately.
 */

import { formatSpielDatum } from "@/shared/utils/format";

import type { SpielerSaisonMembership } from "@/features/spieler/types";
import type { RailBanner } from "@/shared/components/ui/railBanner";

export type SpielerBannerId =
  | "spieler.retired"
  | "spieler.not-in-kader-entry"
  | "spieler.row-retired-since"
  | "spieler.nachgetragen"
  | "spieler.entry-nachgetragen"
  | "spieler.team-changed"
  | "spieler.nummer-geteilt";

/** The panel spots that render one of these inline. */
export type SpielerBannerSpot = "kader-eintritt" | "kader-nachgetragen" | "austragen";

export type SpielerBanner = RailBanner<SpielerBannerId> & { inline: SpielerBannerSpot | null };

export function buildSpielerBanners({
  isRetired,
  saisonId,
  saisonStatus,
  isMember,
  rowInactiveSince,
  isNachgetragen,
  isTeamChanged,
  newlySharedNummer,
}: {
  isRetired: boolean;
  saisonId: string;
  saisonStatus: SpielerSaisonMembership["saisonStatus"];
  isMember: boolean;
  /** The day the squad ROW was retired, or `null` — also `null` when there is no row at all. */
  rowInactiveSince: string | null;
  isNachgetragen: boolean;
  isTeamChanged: boolean;
  /** The shirt this draft would put a SECOND wearer on, or `null` — never a number already shared. */
  newlySharedNummer: string | null;
}): readonly SpielerBanner[] {
  const banners: SpielerBanner[] = [];

  if (isRetired) {
    banners.push({
      id: "spieler.retired",
      severity: "info",
      title: "Dieser Spieler erscheint in keiner Auswahlliste",
      body: "Seine Kadereinträge bleiben bestehen; reaktivieren kannst Du ihn über den Kopf der Seite.",
      inline: null,
    });
  }

  if (!isMember) {
    banners.push({
      id: "spieler.not-in-kader-entry",
      severity: "info",
      title: `In Saison ${saisonId} erscheint dieser Spieler auf keiner Seite`,
      body: "Wähle unten ein Team und nimm ihn auf; Nummer, Position und Stufe kannst Du danach jederzeit ergänzen.",
      inline: "kader-eintritt",
    });

    // What the entry control will record on the admin's behalf, and why: `is_nachgetragen` is
    // derived from the season's status rather than asked, in `FormKaderSection`'s entry branch.
    if (saisonStatus !== "future") {
      banners.push({
        id: "spieler.entry-nachgetragen",
        severity: "info",
        title: "Wird als nachgetragen markiert",
        body: `Die Saison ${saisonId} läuft bereits, der Eintrag wird deshalb als nachgetragen gekennzeichnet.`,
        inline: "kader-nachgetragen",
      });
    }
  }

  if (rowInactiveSince !== null) {
    banners.push({
      id: "spieler.row-retired-since",
      severity: "info",
      title: `Ausgetragen seit ${formatSpielDatum(rowInactiveSince)}`,
      body: `Der Spieler zählt in der Saison ${saisonId} zu keinem Kader. Nummer, Position und Stufe sind gespeichert und kehren beim Reaktivieren zurück.`,
      inline: "austragen",
    });
  }

  if (isNachgetragen) {
    banners.push({
      id: "spieler.nachgetragen",
      severity: "info",
      title: "Dieser Eintrag ist als nachgetragen gekennzeichnet",
      body: `Der Spieler kam erst nach dem Start der Saison ${saisonId} dazu.`,
      inline: null,
    });
  }

  if (isTeamChanged) {
    banners.push({
      id: "spieler.team-changed",
      severity: "warning",
      title: "Teamwechsel wirkt sofort",
      body: "Der Spieler verschwindet aus dem alten Kader und erscheint im neuen, auch auf den öffentlichen Seiten.",
      inline: null,
    });
  }

  // A `warning` and never a refusal: the state is permitted on every write path
  // (`fl_backend/app/core/domain.py :: UNENFORCED`), and the grade is what routes
  // the save through the confirmation.
  if (newlySharedNummer !== null) {
    banners.push({
      id: "spieler.nummer-geteilt",
      severity: "warning",
      title: "Zwei Spieler tragen dann dieselbe Nummer",
      body:
        `Im gewählten Kader trägt bereits jemand die Nummer ${newlySharedNummer}. Das ist erlaubt. ` +
        `Beide erscheinen in der Saison ${saisonId} mit ihr auf den öffentlichen Seiten.`,
      inline: null,
    });
  }

  return banners;
}
