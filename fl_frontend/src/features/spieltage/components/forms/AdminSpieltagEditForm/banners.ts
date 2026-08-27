import type { RailBanner } from "@/shared/components/ui/railBanner";

export type SpieltagBannerId = "spieltag.zeitraum-changed" | "spieltag.ende-vor-beginn" | "spieltag.anzahl-offen";

export type SpieltagBannerSpot = "zeitraum";

export type SpieltagBanner = RailBanner<SpieltagBannerId> & { inline: SpieltagBannerSpot | null };

export function buildSpieltagBanners({
  isZeitraumChanged,
  isEndeVorBeginn,
  spieleAngelegt,
  anzahlSpiele,
}: {
  isZeitraumChanged: boolean;
  isEndeVorBeginn: boolean;
  /** Fixtures actually carrying this matchday's id. */
  spieleAngelegt: number;
  /** How many its phase implies, derived from the season's rules. */
  anzahlSpiele: number;
}): readonly SpieltagBanner[] {
  const banners: SpieltagBanner[] = [];

  if (isZeitraumChanged) {
    banners.push({
      id: "spieltag.zeitraum-changed",
      severity: "warning",
      title: "Der neue Zeitraum muss zu den Spielen passen",
      // Both save refusals a moved span can draw: one naming only the fixtures reads as a promise
      // about the rest. The second is measured against the DATED matchdays alone, so naming the
      // neighbours would point past the rows the endpoint reads.
      body: "Speichern geht nur, wenn alle Spiele des Spieltags im neuen Zeitraum liegen. Der Beginn muss außerdem in die Reihenfolge der Spieltage seiner Phase passen, die schon einen Zeitraum haben.",
      inline: "zeitraum",
    });
  }

  if (isEndeVorBeginn) {
    banners.push({
      id: "spieltag.ende-vor-beginn",
      severity: "danger",
      title: "Das Ende liegt vor dem Beginn",
      body: "Korrigiere eines der beiden Daten.",
      inline: "zeitraum",
    });
  }

  // Reported and never refused, on `fl_backend/app/core/domain.py :: Unenforced`'s reasoning: no write
  // path produces this state, and refusing it would latch shut the stored rows that already hold it.
  if (spieleAngelegt !== anzahlSpiele) {
    banners.push({
      id: "spieltag.anzahl-offen",
      severity: "info",
      // The counts sit in the body as a readout: a sentence carrying them has to agree with both at
      // once, and one of the two is 1 often enough.
      title: spieleAngelegt < anzahlSpiele ? "Es fehlen noch Spiele" : "Es sind mehr Spiele angelegt als erwartet",
      body: `Angelegt: ${String(spieleAngelegt)}. Erwartet: ${String(anzahlSpiele)}.`,
      inline: null,
    });
  }

  return banners;
}
