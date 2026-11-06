import { ausgetragenSeit, REACTIVATION_NEEDS_A_TEAM_IN_SAISON } from "@/features/spieler/constants";

import type { RailBanner } from "@/shared/components/ui/railBanner";

type SpielerBannerId = "spieler.row-retired-since" | "spieler.nachnominiert" | "spieler.rolle-vergeben";

type SpielerBannerSpot = "kader-rolle" | "austragen";

export type SpielerBanner = RailBanner<SpielerBannerId> & { inline: SpielerBannerSpot | null };

/** One list, not two: the rail and the inline spots must never disagree about what is raised. */
export function buildSpielerBanners({
  saisonId,
  rowInactiveSince,
  isRowTeamInSaison,
  istNachnominiert,
  blockedRolle,
}: {
  saisonId: string;
  /** The day the squad ROW was retired, or `null` — also `null` when there is no row at all. */
  rowInactiveSince: string | null;
  /** Whether the row's STORED club still holds a place in this season. Read only where a row is retired. */
  isRowTeamInSaison: boolean;
  istNachnominiert: boolean;
  /** A role the row's team has already given away, with the label and the holder, or `null`. */
  blockedRolle: { label: string; heldBy: string } | null;
}): readonly SpielerBanner[] {
  const banners: SpielerBanner[] = [];

  if (rowInactiveSince !== null) {
    banners.push({
      id: "spieler.row-retired-since",
      severity: "info",
      raisedBy: "state",
      title: ausgetragenSeit(rowInactiveSince),
      // The promise splits where the reactivate does: it names the row's STORED club, and a
      // replacement can have taken that club out of the season since the row was written.
      body: isRowTeamInSaison
        ? "Nummer, Position und Stufe sind gespeichert und kehren beim Reaktivieren zurück."
        : `Das Team dieses Kadereintrags ist in der Saison ${saisonId} nicht mehr dabei. Nummer, Position und Stufe bleiben gespeichert. ${REACTIVATION_NEEDS_A_TEAM_IN_SAISON}`,
      inline: "austragen",
    });
  }

  // The person rather than the row, and the body says what the word means: the player list spells it
  // back as a badge, and no surface but this one tells a reader what it stands for.
  if (istNachnominiert) {
    banners.push({
      id: "spieler.nachnominiert",
      severity: "info",
      // No save moves it — the backend derives it at entry and no payload carries it — so this can only
      // report the flag the row loaded with.
      raisedBy: "state",
      title: "Diese Person wurde nachnominiert",
      body: "Zu Beginn der Saison war sie nicht im Kader.",
      inline: null,
    });
  }

  if (blockedRolle !== null) {
    banners.push({
      id: "spieler.rolle-vergeben",
      severity: "info",
      // `state` off a draft-read map: the picker disables a taken role and a team switch clears one,
      // so the clash reaching here is one the season's stored rows already hold.
      raisedBy: "state",
      title: `${blockedRolle.label} ist im gewählten Team schon vergeben`,
      body: `In der Saison ${saisonId} hat ${blockedRolle.heldBy} diese Rolle. Nimm sie dort zuerst ab, wenn Du sie hier vergeben willst.`,
      inline: "kader-rolle",
    });
  }

  return banners;
}
