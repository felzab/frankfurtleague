import { PHASE_LABELS } from "@/features/saisons/constants";

import type { FLSaisonPhase } from "@/features/saisons/schemas";
import type { RailBanner } from "@/shared/components/ui/railBanner";

export type SpieltagBannerId =
  | "spieltag.phase-changed"
  | "spieltag.position-changed"
  | "spieltag.zeitraum-changed"
  | "spieltag.ende-vor-beginn"
  | "spieltag.name-abgeleitet"
  | "spieltag.anzahl-offen";

export type SpieltagBannerSpot = "phase" | "zeitraum";

export type SpieltagBanner = RailBanner<SpieltagBannerId> & { inline: SpieltagBannerSpot | null };

/** Each count gets its own sentence: a fixed plural turns a lone fixture into "Seine 1 Spiele". */
function describeMitwandernd(spieleAngelegt: number): string {
  if (spieleAngelegt === 0) return "";
  if (spieleAngelegt === 1) return " Sein Spiel nimmt er mit.";
  return ` Seine ${String(spieleAngelegt)} Spiele nimmt er mit.`;
}

export function buildSpieltagBanners({
  label,
  storedPhase,
  draftPhase,
  isPositionChanged,
  isZeitraumChanged,
  isEndeVorBeginn,
  spieleAngelegt,
  anzahlSpiele,
}: {
  /** The matchday's derived name, for a banner that explains where it came from. */
  label: string;
  storedPhase: FLSaisonPhase;
  /** `null` while a picker is untouched — no phase change to report, not a change to nothing. */
  draftPhase: FLSaisonPhase | null;
  isPositionChanged: boolean;
  isZeitraumChanged: boolean;
  isEndeVorBeginn: boolean;
  /** Fixtures actually carrying this matchday's id. */
  spieleAngelegt: number;
  /** How many its phase implies, derived from the season's rules. */
  anzahlSpiele: number;
}): readonly SpieltagBanner[] {
  const banners: SpieltagBanner[] = [];

  // Rail-only and always: it answers "warum kann ich den Namen nicht ändern", and the label is the
  // one thing on this page with no field behind it.
  banners.push({
    id: "spieltag.name-abgeleitet",
    severity: "info",
    title: `Der Name „${label}“ lässt sich nicht eintippen`,
    body: "Er ergibt sich aus Phase und Position. Ändere die Position, um den Spieltag innerhalb seiner Phase zu verschieben.",
    inline: null,
  });

  if (draftPhase !== null && draftPhase !== storedPhase) {
    banners.push({
      id: "spieltag.phase-changed",
      severity: "warning",
      title: `Neue Phase: ${PHASE_LABELS[draftPhase]}`,
      // The position moved with it, so the banner says so rather than leaving the admin to notice.
      body: `Der Spieltag bekommt damit einen neuen Namen und die erste freie Position dieser Phase.${describeMitwandernd(spieleAngelegt)}`,
      inline: "phase",
    });
  }

  // Only on its own: a phase change already reports the new slot it brought with it.
  if (isPositionChanged && draftPhase === storedPhase) {
    banners.push({
      id: "spieltag.position-changed",
      severity: "warning",
      title: "Der Spieltag rückt an eine andere Stelle",
      body: "Damit ändert sich sein Name und die Reihenfolge im Spielplan. Seine Spiele und Termine bleiben, wie sie sind.",
      inline: "phase",
    });
  }

  if (isZeitraumChanged) {
    banners.push({
      id: "spieltag.zeitraum-changed",
      severity: "warning",
      title: "Die Termine ändern die Reihenfolge nicht",
      body: "Über die Reihenfolge entscheidet allein die Position. Speichern geht nur, wenn alle Spiele des Spieltags im neuen Zeitraum liegen.",
      inline: "zeitraum",
    });
  }

  if (isEndeVorBeginn) {
    banners.push({
      id: "spieltag.ende-vor-beginn",
      severity: "danger",
      title: "Das Ende liegt vor dem Beginn",
      body: "So lässt sich der Spieltag nicht speichern. Korrigiere eines der beiden Daten.",
      inline: "zeitraum",
    });
  }

  // Reported and never refused: a season being set up passes through every intermediate count.
  if (spieleAngelegt !== anzahlSpiele) {
    banners.push({
      id: "spieltag.anzahl-offen",
      severity: "info",
      // The counts sit in the body as a readout: a sentence carrying them has to agree with both at
      // once, and one of the two is 1 often enough.
      title: spieleAngelegt < anzahlSpiele ? "Es fehlen noch Spiele" : "Es sind mehr Spiele angelegt als erwartet",
      body: `Angelegt: ${String(spieleAngelegt)}. Erwartet: ${String(anzahlSpiele)}. Das ist kein Fehler, sondern der Stand des Spielplans. Die erwartete Zahl kommt aus den Regeln der Saison.`,
      inline: null,
    });
  }

  return banners;
}
