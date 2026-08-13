/**
 * SAISONS · every Hinweis the season editor can raise, in one list
 *
 * One entry per situation, read by the rail and by the panel that also shows it inline — see the
 * club editor's `banners.ts` for why the two halves cannot be authored separately.
 *
 * The group-swap panel is deliberately outside this list. Its four callouts explain why a control
 * that cannot act cannot act, which is a question only the panel raises and only the panel can
 * answer; the rail lists standing facts about the season, and a lock explanation there would be
 * advice about a control the reader cannot see.
 */

import type { FLSaisonStatus } from "@/features/saisons/schemas";
import type { RailBanner } from "@/shared/components/ui/railBanner";

export type SaisonBannerId =
  | "saison.active"
  | "saison.past"
  | "saison.end-before-start"
  | "saison.qualifiers-overflow"
  | "saison.points-changed"
  | "saison.stufen-changed"
  | "saison.rollover-blocked";

/** The panel spots that render one of these inline. */
export type SaisonBannerSpot = "zeitraum" | "regeln-qualifikanten" | "regeln-status" | "umstellung";

export type SaisonBanner = RailBanner<SaisonBannerId> & { inline: SaisonBannerSpot | null };

export function buildSaisonBanners({
  saisonStatus,
  isEndBeforeStart,
  qualifiersPerGroup,
  teamsPerGroup,
  isPointsChanged,
  isStufenChanged,
  outgoingSaisonId,
  offeneSpieleCount,
}: {
  saisonStatus: FLSaisonStatus;
  isEndBeforeStart: boolean;
  qualifiersPerGroup: number;
  teamsPerGroup: number;
  isPointsChanged: boolean;
  isStufenChanged: boolean;
  /** The season the rollover would close, or `null` when nothing holds `active`. */
  outgoingSaisonId: string | null;
  offeneSpieleCount: number;
}): readonly SaisonBanner[] {
  const banners: SaisonBanner[] = [];

  if (saisonStatus === "active") {
    // Two facts that do not follow from each other, which is why they are one entry rather than two:
    // this season is what every page without a selector shows, and the table behind it is scored on
    // every read (ADR-0019) rather than stored.
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
      title: "Eine Regeländerung wirkt hier rückwirkend",
      body: "Die Tabellen dieser Saison ändern sich mit, obwohl sie längst gespielt ist.",
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

  if (qualifiersPerGroup > teamsPerGroup) {
    banners.push({
      id: "saison.qualifiers-overflow",
      severity: "danger",
      title: "Mehr Qualifikanten als Teams pro Gruppe",
      body: "So lässt sich die Saison nicht speichern. Eine Gruppe kann nicht mehr Teams qualifizieren, als sie fasst.",
      inline: "regeln-qualifikanten",
    });
  }

  // The one edit on this page whose effect is retroactive and invisible at the field: the table is
  // scored on every read rather than stored (ADR-0019), so the numbers move with nothing announcing
  // that they did.
  if (isPointsChanged) {
    banners.push({
      id: "saison.points-changed",
      severity: "warning",
      title: "Punkte wirken auf die ganze Saison",
      body: "Auch längst gespielte Spiele zählen dann nach den neuen Punkten.",
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

  if (saisonStatus !== "active" && outgoingSaisonId !== null && offeneSpieleCount > 0) {
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
