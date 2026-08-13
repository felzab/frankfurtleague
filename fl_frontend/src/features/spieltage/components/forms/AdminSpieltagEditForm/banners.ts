/**
 * SPIELTAGE · every Hinweis the matchday editor can raise, in one list
 *
 * One entry per situation, read by the rail and by the panel that also shows it inline — see the
 * club editor's `banners.ts` for why the two halves cannot be authored separately.
 *
 * **This is the list ADR-0072 rests on.** A matchday holds three fields and six backend refusals, and
 * these entries are the ones a page can state before the admin reaches the control rather than after
 * the endpoint has already refused.
 */

import { PHASE_LABELS } from "@/features/saisons/constants";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSaisonPhase } from "@/features/saisons/schemas";
import type { RailBanner } from "@/shared/components/ui/railBanner";

export type SpieltagBannerId =
  | "spieltag.retired"
  | "spieltag.retired-since"
  | "spieltag.phase-changed"
  | "spieltag.zeitraum-changed"
  | "spieltag.ende-vor-beginn"
  | "spieltag.name-abgeleitet"
  | "spieltag.anzahl-offen"
  | "spieltag.retire-blockiert-ergebnis"
  | "spieltag.retire-blockiert-untergrenze";

/** The panel spots that render one of these inline. */
export type SpieltagBannerSpot = "phase" | "zeitraum" | "stilllegen";

export type SpieltagBanner = RailBanner<SpieltagBannerId> & { inline: SpieltagBannerSpot | null };

export function buildSpieltagBanners({
  label,
  inactiveSince,
  storedPhase,
  draftPhase,
  isZeitraumChanged,
  isEndeVorBeginn,
  spieleAngelegt,
  anzahlSpiele,
  spieleGespielt,
  livePhaseCount,
  impliedPhaseCount,
}: {
  /** The matchday's derived name, for a banner that explains where it came from (ADR-0051). */
  label: string;
  /** The day this matchday was retired, or `null` while it is played (ADR-0025). */
  inactiveSince: string | null;
  storedPhase: FLSaisonPhase;
  /** `null` while a picker is untouched — no phase change to report, not a change to nothing. */
  draftPhase: FLSaisonPhase | null;
  isZeitraumChanged: boolean;
  isEndeVorBeginn: boolean;
  /** Fixtures actually carrying this matchday's id. */
  spieleAngelegt: number;
  /** How many its phase implies, derived from the season's rules (ADR-0052). */
  anzahlSpiele: number;
  /** How many of its fixtures carry a result — what `REQ-RETIRE-002` refuses over. */
  spieleGespielt: number;
  /** Live matchdays the STORED phase holds, this one included. */
  livePhaseCount: number;
  /** The floor `REQ-RETIRE-005` holds that phase to. */
  impliedPhaseCount: number;
}): readonly SpieltagBanner[] {
  const banners: SpieltagBanner[] = [];

  if (inactiveSince !== null) {
    banners.push({
      id: "spieltag.retired",
      severity: "info",
      title: "Dieser Spieltag steht auf keinem öffentlichen Spielplan",
      body: "Seine Spiele bleiben vollständig erhalten und auflösbar; sichtbar werden sie wieder, sobald Du ihn reaktivierst.",
      inline: null,
    });

    banners.push({
      id: "spieltag.retired-since",
      severity: "info",
      title: `Stillgelegt seit ${formatSpielDatum(inactiveSince)}`,
      body: "Der Spieltag steht auf keinem öffentlichen Spielplan, seine Spiele bleiben aber vollständig erhalten. Beim Reaktivieren wird geprüft, ob sein Zeitraum noch in die Saison passt.",
      inline: "stilllegen",
      supersedes: ["spieltag.retired"],
    });
  }

  // Rail-only and always: it is the answer to "warum kann ich den Namen nicht ändern", and the label
  // is the one thing on this page with no field behind it at all.
  banners.push({
    id: "spieltag.name-abgeleitet",
    severity: "info",
    title: `Der Name „${label}“ ergibt sich von selbst`,
    body: "Er folgt aus der Phase und der Position darin, und die Position folgt aus Phase und Beginn. Verschieben heißt also: das Datum ändern.",
    inline: null,
  });

  if (draftPhase !== null && draftPhase !== storedPhase) {
    banners.push({
      id: "spieltag.phase-changed",
      severity: "warning",
      title: `Der Spieltag rückt in die ${PHASE_LABELS[draftPhase]}`,
      body: `Mit der Phase ändert sich auch, wo er in der Saison steht und wie er heißt — und wie viele Spiele von ihm erwartet werden. Seine ${String(spieleAngelegt)} angelegten Spiele wandern mit.`,
      inline: "phase",
    });
  }

  if (isZeitraumChanged) {
    banners.push({
      id: "spieltag.zeitraum-changed",
      severity: "warning",
      title: "Der neue Zeitraum entscheidet über die Reihenfolge",
      body: "Innerhalb einer Phase wird nach Beginn sortiert, der Spieltag kann also seinen Platz und damit seinen Namen wechseln. Liegt ein bereits angelegtes Spiel außerhalb des neuen Zeitraums, lehnt der Server die Änderung ab.",
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

  // Reported and never refused (ADR-0052): a season being set up passes through every intermediate
  // count, so this states the gap rather than calling it a mistake.
  if (spieleAngelegt !== anzahlSpiele) {
    banners.push({
      id: "spieltag.anzahl-offen",
      severity: "info",
      title:
        spieleAngelegt < anzahlSpiele
          ? `${String(spieleAngelegt)} von ${String(anzahlSpiele)} erwarteten Spielen sind angelegt`
          : `${String(spieleAngelegt)} Spiele sind angelegt, erwartet werden ${String(anzahlSpiele)}`,
      body: "Die erwartete Zahl folgt aus den Regeln der Saison und dieser Phase. Eine Abweichung ist kein Fehler — sie zeigt nur, wo der Spielplan noch nicht fertig ist.",
      inline: null,
    });
  }

  if (inactiveSince === null && spieleGespielt > 0) {
    banners.push({
      id: "spieltag.retire-blockiert-ergebnis",
      severity: "info",
      title:
        spieleGespielt === 1
          ? "1 Spiel dieses Spieltags hat ein Ergebnis"
          : `${String(spieleGespielt)} Spiele dieses Spieltags haben ein Ergebnis`,
      body: "Stilllegen ist deshalb nicht möglich: Der Spieltag würde samt diesen Ergebnissen vom öffentlichen Spielplan verschwinden. Verschiebe die Spiele auf einen anderen Spieltag oder sage sie ab.",
      inline: "stilllegen",
    });
  }

  // The second retirement refusal, and the one nothing else on the admin surface can see: it is a
  // fact about the PHASE rather than about this matchday (`REQ-RETIRE-005`).
  if (inactiveSince === null && spieleGespielt === 0 && livePhaseCount <= impliedPhaseCount) {
    banners.push({
      id: "spieltag.retire-blockiert-untergrenze",
      severity: "info",
      title: `Die ${PHASE_LABELS[storedPhase]} braucht mindestens ${String(impliedPhaseCount)} Spieltage`,
      body: `Sie hat zurzeit ${String(livePhaseCount)}, Stilllegen ist deshalb nicht möglich. Lege zuerst einen weiteren Spieltag dieser Phase an, oder passe die Regeln der Saison an.`,
      inline: "stilllegen",
    });
  }

  return banners;
}
