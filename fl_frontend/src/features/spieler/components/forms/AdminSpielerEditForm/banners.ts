import { REACTIVATION_NEEDS_A_TEAM_IN_SAISON } from "@/features/spieler/constants";
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

export type SpielerBannerSpot = "kader-eintritt" | "kader-nachgetragen" | "austragen";

export type SpielerBanner = RailBanner<SpielerBannerId> & { inline: SpielerBannerSpot | null };

/** One list, not two: the rail and the inline spots must never disagree about what is raised. */
export function buildSpielerBanners({
  isRetired,
  saisonId,
  saisonStatus,
  isMember,
  rowInactiveSince,
  isRowTeamInSaison,
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
  /** Whether the row's STORED club still holds a place in this season. Read only where a row is retired. */
  isRowTeamInSaison: boolean;
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

    // `is_nachgetragen` is derived from the season's status rather than asked — see `FormKaderSection`.
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
      // The promise splits where the reactivate does: it names the row's STORED club, and a
      // replacement can have taken that club out of the season since the row was written.
      body: isRowTeamInSaison
        ? `Der Spieler zählt in der Saison ${saisonId} zu keinem Kader. Nummer, Position und Stufe sind gespeichert und kehren beim Reaktivieren zurück.`
        : `Das Team dieses Kadereintrags ist in der Saison ${saisonId} nicht mehr dabei. Nummer, Position und Stufe bleiben gespeichert. ${REACTIVATION_NEEDS_A_TEAM_IN_SAISON}`,
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
  // (`fl_backend/app/core/domain.py :: UNENFORCED`), and the grade routes the save through confirmation.
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
