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
  | "spieler.rolle-vergeben";

export type SpielerBannerSpot = "kader-eintritt" | "kader-nachgetragen" | "kader-rolle" | "austragen";

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
  blockedRolle,
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
  /** A role the DRAFT's team has already given away, with the label and the holder, or `null`. */
  blockedRolle: { label: string; heldBy: string } | null;
}): readonly SpielerBanner[] {
  const banners: SpielerBanner[] = [];

  if (isRetired) {
    banners.push({
      id: "spieler.retired",
      severity: "info",
      title: "Dieser Spieler erscheint in keiner Auswahlliste",
      // The way back is the header's own Reaktivieren control, on screen beside this.
      body: "Seine Kadereinträge bleiben erhalten.",
      inline: null,
    });
  }

  if (!isMember) {
    banners.push({
      id: "spieler.not-in-kader-entry",
      severity: "info",
      title: `In Saison ${saisonId} erscheint dieser Spieler auf keiner Seite`,
      body: "Wähle unten ein Team und nimm ihn auf.",
      inline: "kader-eintritt",
    });

    // `is_nachgetragen` is derived from the season's status rather than asked — see `FormKaderSection`.
    if (saisonStatus !== "future") {
      banners.push({
        id: "spieler.entry-nachgetragen",
        severity: "info",
        title: "Wird als nachgetragen markiert",
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
        ? "Nummer, Position und Stufe sind gespeichert und kehren beim Reaktivieren zurück."
        : `Das Team dieses Kadereintrags ist in der Saison ${saisonId} nicht mehr dabei. Nummer, Position und Stufe bleiben gespeichert. ${REACTIVATION_NEEDS_A_TEAM_IN_SAISON}`,
      inline: "austragen",
    });
  }

  if (isNachgetragen) {
    banners.push({
      id: "spieler.nachgetragen",
      severity: "info",
      title: "Dieser Eintrag ist nachgetragen",
      inline: null,
    });
  }

  if (isTeamChanged) {
    banners.push({
      id: "spieler.team-changed",
      severity: "warning",
      title: "Teamwechsel wirkt sofort",
      body: "Der Spieler verschwindet aus dem alten Kader und erscheint im neuen.",
      inline: null,
    });
  }

  if (blockedRolle !== null) {
    banners.push({
      id: "spieler.rolle-vergeben",
      severity: "info",
      title: `${blockedRolle.label} ist im gewählten Team schon vergeben`,
      body: `In der Saison ${saisonId} hat ${blockedRolle.heldBy} diese Rolle. Nimm sie dort zuerst ab, wenn Du sie hier vergeben willst.`,
      inline: "kader-rolle",
    });
  }

  return banners;
}
