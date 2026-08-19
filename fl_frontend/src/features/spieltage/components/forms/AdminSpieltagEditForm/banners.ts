import { PHASE_LABELS } from "@/features/saisons/constants";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSaisonPhase } from "@/features/saisons/schemas";
import type { RailBanner } from "@/shared/components/ui/railBanner";

export type SpieltagBannerId =
  | "spieltag.retired-since"
  | "spieltag.phase-changed"
  | "spieltag.zeitraum-changed"
  | "spieltag.ende-vor-beginn"
  | "spieltag.name-abgeleitet"
  | "spieltag.anzahl-offen"
  | "spieltag.retire-blockiert-ergebnis"
  | "spieltag.retire-blockiert-untergrenze";

export type SpieltagBannerSpot = "phase" | "zeitraum" | "stilllegen";

export type SpieltagBanner = RailBanner<SpieltagBannerId> & { inline: SpieltagBannerSpot | null };

/**
 * Whether the phase stands exactly on the floor `REQ-RETIRE-005` holds it to, this matchday included.
 * Mirrors `find_spieltag_retire_refusal`: the endpoint refuses the STEP across the floor and never
 * the state under it, so a phase already short retires.
 */
export function standsAtThePhaseFloor(livePhaseCount: number, impliedPhaseCount: number): boolean {
  return livePhaseCount - 1 < impliedPhaseCount && livePhaseCount >= impliedPhaseCount && impliedPhaseCount > 0;
}

/** Each count gets its own sentence: a fixed plural turns a lone fixture into "Seine 1 Spiele". */
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
  /** The matchday's derived name, for a banner that explains where it came from. */
  label: string;
  /** The day this matchday was retired, or `null` while it is played. */
  inactiveSince: string | null;
  storedPhase: FLSaisonPhase;
  /** `null` while a picker is untouched — no phase change to report, not a change to nothing. */
  draftPhase: FLSaisonPhase | null;
  isZeitraumChanged: boolean;
  isEndeVorBeginn: boolean;
  /** Fixtures actually carrying this matchday's id. */
  spieleAngelegt: number;
  /** How many its phase implies, derived from the season's rules. */
  anzahlSpiele: number;
  /** How many of its fixtures carry a result — what `REQ-RETIRE-002` refuses over. */
  spieleGespielt: number;
  /** Live matchdays the STORED phase holds, this one included. */
  livePhaseCount: number;
  /** The floor `REQ-RETIRE-005` holds that phase to. */
  impliedPhaseCount: number;
}): readonly SpieltagBanner[] {
  const banners: SpieltagBanner[] = [];

  // The retirement date leads the title, because it is what an admin checks the state against.
  if (inactiveSince !== null) {
    banners.push({
      id: "spieltag.retired-since",
      severity: "info",
      title: `Stillgelegt seit ${formatSpielDatum(inactiveSince)}`,
      body: "Seine Spiele sind nicht verloren. Zum Reaktivieren muss sein Zeitraum noch in die Saison passen.",
      inline: "stilllegen",
    });
  }

  // Rail-only and always: it answers "warum kann ich den Namen nicht ändern", and the label is the
  // one thing on this page with no field behind it.
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
      // The phase label leads as a tag rather than sitting in the sentence: every knockout round in
      // `PHASE_LABELS` is neuter, so a fixed article makes "die Halbfinale" of it.
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
