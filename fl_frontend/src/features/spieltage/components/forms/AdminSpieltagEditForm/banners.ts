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

/**
 * Whether the phase stands exactly on the floor `REQ-RETIRE-005` holds it to, this matchday included.
 *
 * Mirrors `find_spieltag_retire_refusal`: the endpoint refuses the STEP across the floor and never the
 * state under it, so a phase already short retires and a phase with no floor always does. Exported
 * because the banner and the button it explains would otherwise compute the same arithmetic twice.
 */
export function standsAtThePhaseFloor(livePhaseCount: number, impliedPhaseCount: number): boolean {
  return livePhaseCount - 1 < impliedPhaseCount && livePhaseCount >= impliedPhaseCount && impliedPhaseCount > 0;
}

/**
 * The sentence about fixtures moving with the matchday, or nothing where there are none.
 *
 * Each count gets its own sentence rather than one with the number substituted: a fixed plural turns a
 * lone fixture into "Seine 1 Spiele", and an empty matchday into a reassurance about nothing.
 */
function describeMitwandernd(spieleAngelegt: number): string {
  if (spieleAngelegt === 0) return "";
  if (spieleAngelegt === 1) return " Sein Spiel nimmt er mit.";
  return ` Seine ${String(spieleAngelegt)} Spiele nimmt er mit.`;
}

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
      body: "Seine Spiele sind nicht verloren. Sobald Du ihn reaktivierst, sind sie wieder zu sehen.",
      inline: null,
    });

    banners.push({
      id: "spieltag.retired-since",
      severity: "info",
      title: `Stillgelegt seit ${formatSpielDatum(inactiveSince)}`,
      body: "Seine Spiele sind nicht verloren. Zum Reaktivieren muss sein Zeitraum noch in die Saison passen.",
      inline: "stilllegen",
      supersedes: ["spieltag.retired"],
    });
  }

  // Rail-only and always: it is the answer to "warum kann ich den Namen nicht ändern", and the label
  // is the one thing on this page with no field behind it at all.
  banners.push({
    id: "spieltag.name-abgeleitet",
    severity: "info",
    title: `Der Name „${label}“ lässt sich nicht eintippen`,
    body: "Er richtet sich nach Phase und Beginn. Ändere den Beginn, um den Spieltag zu verschieben.",
    inline: null,
  });

  if (draftPhase !== null && draftPhase !== storedPhase) {
    banners.push({
      id: "spieltag.phase-changed",
      severity: "warning",
      title: `Neue Phase: ${PHASE_LABELS[draftPhase]}`,
      body: `Der Spieltag bekommt damit einen neuen Namen und eine neue Position in der Saison.${describeMitwandernd(spieleAngelegt)}`,
      inline: "phase",
    });
  }

  if (isZeitraumChanged) {
    banners.push({
      id: "spieltag.zeitraum-changed",
      severity: "warning",
      title: "Der Spieltag kann dadurch anders heißen",
      body: "Innerhalb einer Phase entscheidet der Beginn über Reihenfolge und Namen. Speichern geht nur, wenn alle Spiele des Spieltags im neuen Zeitraum liegen.",
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
      // The counts sit in the body as a readout rather than in a sentence: any sentence carrying them
      // has to agree with both at once, and one of the two is 1 often enough to be the normal case.
      title: spieleAngelegt < anzahlSpiele ? "Es fehlen noch Spiele" : "Es sind mehr Spiele angelegt als erwartet",
      body: `Angelegt: ${String(spieleAngelegt)}. Erwartet: ${String(anzahlSpiele)}. Das ist kein Fehler, sondern der Stand des Spielplans. Die erwartete Zahl kommt aus den Regeln der Saison.`,
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
      body: "Stilllegen ist deshalb nicht möglich. Verschiebe die Spiele auf einen anderen Spieltag oder sage sie ab.",
      inline: "stilllegen",
    });
  }

  // The second retirement refusal, and the one nothing else on the admin surface can see: it is a
  // fact about the PHASE rather than about this matchday (`REQ-RETIRE-005`).
  if (inactiveSince === null && spieleGespielt === 0 && standsAtThePhaseFloor(livePhaseCount, impliedPhaseCount)) {
    banners.push({
      id: "spieltag.retire-blockiert-untergrenze",
      severity: "info",
      // The phase label leads as a tag rather than sitting in the sentence: "die Halbfinale" is what a
      // fixed article makes of it, and every knockout round in `PHASE_LABELS` is neuter.
      title:
        impliedPhaseCount === 1
          ? `${PHASE_LABELS[storedPhase]}: Dies ist der einzige Spieltag der Phase`
          : `${PHASE_LABELS[storedPhase]}: Die Phase hat genau die ${String(impliedPhaseCount)} Spieltage, die sie mindestens braucht`,
      body:
        impliedPhaseCount === 1
          ? "Stilllegen ist deshalb nicht möglich, denn die Phase stünde danach ohne Spieltag da. Lege zuerst einen weiteren Spieltag dieser Phase an, oder passe die Regeln der Saison an."
          : "Stilllegen ist deshalb nicht möglich, denn danach wäre es einer zu wenig. Lege zuerst einen weiteren Spieltag dieser Phase an, oder passe die Regeln der Saison an.",
      inline: "stilllegen",
    });
  }

  return banners;
}
