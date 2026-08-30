import type { FLSaisonStatus } from "@/features/saisons/schemas";
import type { RailBanner } from "@/shared/components/ui/railBanner";

export type SaisonBannerId =
  | "saison.past"
  | "saison.drawn"
  | "saison.end-before-start"
  | "saison.qualifiers-overflow"
  | "saison.scoring-changed"
  | "saison.placing-changed"
  | "saison.stufen-changed"
  | "saison.rollover-blocked";

export type SaisonBannerSpot = "zeitraum" | "regeln-qualifikanten" | "regeln-status" | "umstellung";

export type SaisonBanner = RailBanner<SaisonBannerId> & { inline: SaisonBannerSpot | null };

export function buildSaisonBanners({
  saisonStatus,
  isEndBeforeStart,
  qualifiersPerGroup,
  teamsPerGroup,
  isRescoringChanged,
  isPlacingChanged,
  isStufenChanged,
  hasDrawnSpiele,
  outgoingSaisonId,
  offeneSpieleCount,
}: {
  saisonStatus: FLSaisonStatus;
  isEndBeforeStart: boolean;
  qualifiersPerGroup: number | null;
  teamsPerGroup: number | null;
  /** Whether the draft moves a rule under which every played fixture is scored again. */
  isRescoringChanged: boolean;
  /** Whether the draft moves a rule deciding who comes out of a group ahead of whom. */
  isPlacingChanged: boolean;
  isStufenChanged: boolean;
  /** `REQ-RULES-011`'s condition: the season holds fixtures, which is what freezes the three they were drawn from. */
  hasDrawnSpiele: boolean;
  /** The season the rollover would close, or `null` when nothing holds `active`. */
  outgoingSaisonId: string | null;
  offeneSpieleCount: number;
}): readonly SaisonBanner[] {
  const banners: SaisonBanner[] = [];

  if (saisonStatus === "past") {
    banners.push({
      id: "saison.past",
      severity: "info",
      raisedBy: "state",
      title: "Die Wertung bleibt, wie sie gespielt wurde",
      inline: "regeln-status",
    });
  }

  // `info`, never `warning`: the freeze is a standing property of a drawn season rather than
  // something this save would cause.
  if (hasDrawnSpiele) {
    banners.push({
      id: "saison.drawn",
      severity: "info",
      raisedBy: "state",
      title: "Der Aufbau der Saison steht fest",
      body: "Gruppen, Teams pro Gruppe und Qualifikanten sind gesperrt, solange der Spielplan steht.",
      inline: null,
    });
  }

  if (isEndBeforeStart) {
    banners.push({
      id: "saison.end-before-start",
      severity: "danger",
      raisedBy: "change",
      title: "Das Ende liegt vor dem Beginn",
      body: "So lässt sich die Saison nicht speichern. Verlege das Ende hinter den Beginn.",
      inline: "zeitraum",
    });
  }

  // Both entered or nothing said: an unanswered count cannot over-qualify, and a banner about a rule
  // nobody has typed yet reads as a fault the admin caused.
  if (qualifiersPerGroup !== null && teamsPerGroup !== null && qualifiersPerGroup > teamsPerGroup) {
    banners.push({
      id: "saison.qualifiers-overflow",
      severity: "danger",
      // `state` though the two figures are the draft's: a season stored over-qualifying still saves
      // its dates (`docs/backend/spec.md :: I44`), and the step that would introduce or widen the
      // excess is refused rather than confirmed.
      raisedBy: "state",
      title: "Mehr Qualifikanten als Teams pro Gruppe",
      body: "Speichern lässt sich die Saison nur, solange sich das nicht weiter verschlechtert. Senke die Qualifikanten oder erhöhe die Teams pro Gruppe.",
      inline: "regeln-qualifikanten",
    });
  }

  // The reach is invisible at the field: the table is scored on read, so a total moves with nothing
  // announcing it. Conditional because a season with nothing played reaches this too. The body keeps
  // its `auch` under §1.12's played-fixture exception.
  if (isRescoringChanged) {
    banners.push({
      id: "saison.scoring-changed",
      severity: "warning",
      raisedBy: "change",
      title: "Die Tabelle könnte sich ändern",
      body: "Auch längst gespielte Spiele werden nach den neuen Regeln gewertet.",
      inline: null,
    });
  }

  // Its sibling and separate from it: nobody's total moves here, only the order under the totals. The
  // subject is the placings rather than the qualifier cut read off them; conditional because
  // `tiebreak_order` decides nothing until two teams stand level.
  if (isPlacingChanged) {
    banners.push({
      id: "saison.placing-changed",
      severity: "warning",
      raisedBy: "change",
      title: "Die Platzierungen der Teams könnten sich ändern",
      inline: null,
    });
  }

  // Fixed copy, never re-derived from §1.12: the sentence is the whole entry, since it already
  // answers what the change raises.
  if (isStufenChanged) {
    banners.push({
      id: "saison.stufen-changed",
      severity: "info",
      raisedBy: "change",
      title: "Bestehende Kadereinträge behalten ihre Stufe",
      inline: null,
    });
  }

  // `future` alone: a `past` season is refused by `REQ-ACTIVATE-002` whatever the outgoing season
  // holds, so its open fixtures are not the blocker. `state`: the rollover is a control of its own,
  // so this editor's save neither causes nor clears them.
  if (saisonStatus === "future" && outgoingSaisonId !== null && offeneSpieleCount > 0) {
    banners.push({
      id: "saison.rollover-blocked",
      severity: "danger",
      raisedBy: "state",
      title:
        offeneSpieleCount === 1
          ? `1 Spiel der Saison ${outgoingSaisonId} hat noch kein Ergebnis`
          : `${String(offeneSpieleCount)} Spiele der Saison ${outgoingSaisonId} haben noch kein Ergebnis`,
      body: `Solange das so ist, lässt sich Saison ${outgoingSaisonId} nicht abschließen. Trage die fehlenden Ergebnisse ein oder sage die Spiele ab.`,
      inline: "umstellung",
    });
  }

  return banners;
}
