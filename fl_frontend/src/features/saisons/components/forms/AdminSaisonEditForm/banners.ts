import type { FLSaisonStatus } from "@/features/saisons/schemas";
import type { RailBanner } from "@/shared/components/ui/railBanner";

export type SaisonBannerId =
  | "saison.active"
  | "saison.past"
  | "saison.end-before-start"
  | "saison.qualifiers-overflow"
  | "saison.points-changed"
  | "saison.tiebreak-changed"
  | "saison.stufen-changed"
  | "saison.rollover-blocked";

export type SaisonBannerSpot = "zeitraum" | "regeln-qualifikanten" | "regeln-status" | "umstellung";

export type SaisonBanner = RailBanner<SaisonBannerId> & { inline: SaisonBannerSpot | null };

export function buildSaisonBanners({
  saisonStatus,
  isEndBeforeStart,
  qualifiersPerGroup,
  teamsPerGroup,
  isPointsChanged,
  isTiebreakChanged,
  isStufenChanged,
  outgoingSaisonId,
  offeneSpieleCount,
}: {
  saisonStatus: FLSaisonStatus;
  isEndBeforeStart: boolean;
  qualifiersPerGroup: number;
  teamsPerGroup: number;
  isPointsChanged: boolean;
  isTiebreakChanged: boolean;
  isStufenChanged: boolean;
  /** The season the rollover would close, or `null` when nothing holds `active`. */
  outgoingSaisonId: string | null;
  offeneSpieleCount: number;
}): readonly SaisonBanner[] {
  const banners: SaisonBanner[] = [];

  if (saisonStatus === "active") {
    // Two facts that do not follow from each other, hence one entry rather than two: this season is
    // what every page without a selector shows, and its table is scored on read rather than stored.
    banners.push({
      id: "saison.active",
      severity: "info",
      title: "Änderungen wirken sofort auf der ganzen Seite",
      body: "Wer keine Saison auswählt, sieht diese. Eine Regeländerung wirkt sofort, auch auf längst gespielte Spiele.",
      inline: "regeln-status",
    });
  }

  if (saisonStatus === "past") {
    banners.push({
      id: "saison.past",
      severity: "info",
      title: "Die Wertung bleibt, wie sie gespielt wurde",
      body: "Punkte, Reihenfolge bei Punktgleichheit und Qualifikanten wirken rückwirkend und sind deshalb gesperrt.",
      inline: "regeln-status",
    });
  }

  if (isEndBeforeStart) {
    banners.push({
      id: "saison.end-before-start",
      severity: "danger",
      title: "Das Ende liegt vor dem Beginn",
      body: "So lässt sich die Saison nicht speichern. Meistens ist es ein Zahlendreher im Jahr.",
      inline: "zeitraum",
    });
  }

  // The save is NOT blocked, unlike the span banner above: the server refuses only a step that makes
  // this worse, so a season already over-qualifying still saves its dates (`docs/backend/spec.md :: I44`).
  if (qualifiersPerGroup > teamsPerGroup) {
    banners.push({
      id: "saison.qualifiers-overflow",
      severity: "danger",
      title: "Mehr Qualifikanten als Teams pro Gruppe",
      body: "Eine Gruppe kann nicht mehr Teams qualifizieren, als sie fasst. Speichern lässt sich die Saison nur, solange sich dieses Verhältnis nicht weiter verschlechtert.",
      inline: "regeln-qualifikanten",
    });
  }

  // The one edit whose effect is retroactive and invisible at the field: the table is scored on read,
  // so the numbers move with nothing announcing it.
  if (isPointsChanged) {
    banners.push({
      id: "saison.points-changed",
      severity: "warning",
      title: "Punkte wirken auf die ganze Saison",
      body: "Auch längst gespielte Spiele zählen dann nach den neuen Punkten.",
      inline: null,
    });
  }

  // The points banner's sibling, and separate from it: the table is re-sorted rather than re-scored,
  // so every total stays put while the order under it moves.
  if (isTiebreakChanged) {
    banners.push({
      id: "saison.tiebreak-changed",
      severity: "warning",
      title: "Die Tabellen werden neu sortiert",
      body: "Punktgleiche Teams dieser Saison können danach in anderer Reihenfolge stehen, auch in längst gespielten Gruppen.",
      inline: null,
    });
  }

  if (isStufenChanged) {
    banners.push({
      id: "saison.stufen-changed",
      severity: "info",
      title: "Stufen begrenzen nur die Auswahl",
      body: "Bestehende Kadereinträge behalten ihre Stufe, auch eine, die diese Saison nicht mehr anbietet.",
      inline: null,
    });
  }

  // `future` alone: a `past` season is refused by `REQ-ACTIVATE-002` whatever the outgoing season
  // holds, so its open fixtures are not the blocker — and this `danger` banner would raise the save
  // dialog over an unrelated edit.
  if (saisonStatus === "future" && outgoingSaisonId !== null && offeneSpieleCount > 0) {
    banners.push({
      id: "saison.rollover-blocked",
      severity: "danger",
      title:
        offeneSpieleCount === 1
          ? `1 Spiel der Saison ${outgoingSaisonId} hat noch kein Ergebnis`
          : `${String(offeneSpieleCount)} Spiele der Saison ${outgoingSaisonId} haben noch kein Ergebnis`,
      body: `Solange das so ist, lässt sich Saison ${outgoingSaisonId} nicht abschließen. Trage die fehlenden Ergebnisse ein oder sage die Spiele ab. Ein abgesagtes Spiel gilt als erledigt.`,
      inline: "umstellung",
    });
  }

  return banners;
}
