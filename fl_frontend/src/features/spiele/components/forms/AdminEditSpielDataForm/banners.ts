/**
 * SPIELE · every Hinweis the match editor can raise, in one list
 *
 * One entry per situation, read by the rail and by the panel that also shows it inline — see the
 * club editor's `banners.ts` for why the two halves cannot be authored separately. The match editor
 * is the one that had the rail build a banner of its own, so its list was the only one that could
 * not be read off a single file at all.
 */

import type { FLSpielQuelle, FLSpielTeamField } from "@/features/spiele/schemas";
import type { RailBanner } from "@/shared/components/ui/railBanner";

export type SpielBannerId =
  | "spiel.team1-manual"
  | "spiel.team2-manual"
  | "spiel.team1-unqualified"
  | "spiel.team2-unqualified"
  | "spiel.canceled-meaning"
  | "spiel.knockout-feeds"
  | "spiel.canceled-decided"
  | "spiel.is-canceled"
  | "spiel.void-preview"
  | "spiel.release-preview";

/** The panel spots that render one of these inline. */
export type SpielBannerSpot =
  | "team1-manuell"
  | "team2-manuell"
  | "team1-qualifikation"
  | "team2-qualifikation"
  | "absage-bedeutung"
  | "absage-turnierbaum"
  | "absage-wertung";

export type SpielBanner = RailBanner<SpielBannerId> & { inline: SpielBannerSpot | null };

/** One side of the fixture as the draft holds it — the shape both per-side banners are built from. */
export type SpielBannerSide = {
  fieldName: "team1" | "team2";
  label: string;
  quelle: FLSpielQuelle | null;
  team: FLSpielTeamField | null;
};

/** A list of fixture numbers as German writes it: "29, 30 und 31", with "und" and no serial comma. */
export const joinGerman = (spielNummern: readonly number[]): string =>
  new Intl.ListFormat("de-DE", { style: "long", type: "conjunction" }).format(spielNummern.map(String));

export function buildSpielBanners({
  isKnockout,
  sides,
  knockoutTeamIds,
  isBeingCalledOff,
  isCanceled,
  dependentSpielNummern,
  hasDecidedErgebnis,
  voidedSpielNummern,
  releasedSpielNummern,
}: {
  isKnockout: boolean;
  sides: readonly SpielBannerSide[];
  /** Every team the bracket already fields — the client's proxy for "qualified" (ADR-0035). */
  knockoutTeamIds: ReadonlySet<string>;
  /** The fixture is being called off in THIS edit, rather than having been off already. */
  isBeingCalledOff: boolean;
  isCanceled: boolean;
  /** Fixtures whose occupants this one's result decides, empty where it decides none (ADR-0041). */
  dependentSpielNummern: readonly number[];
  hasDecidedErgebnis: boolean;
  /** Fixtures the dry run says this save takes a stored result from, never ones that merely could. */
  voidedSpielNummern: readonly number[];
  releasedSpielNummern: readonly number[];
}): readonly SpielBanner[] {
  const banners: SpielBanner[] = [];

  for (const side of sides) {
    if (!isKnockout || side.quelle !== null) continue;

    banners.push({
      id: side.fieldName === "team1" ? "spiel.team1-manual" : "spiel.team2-manual",
      severity: "danger",
      title: `${side.label} wird nicht mehr automatisch gefüllt`,
      body: "Die Seite bleibt so stehen, wie Du sie einträgst; kein späteres Ergebnis ändert sie.",
      inline: side.fieldName === "team1" ? "team1-manuell" : "team2-manuell",
    });

    if (side.team !== null && !knockoutTeamIds.has(side.team.team_id)) {
      banners.push({
        id: side.fieldName === "team1" ? "spiel.team1-unqualified" : "spiel.team2-unqualified",
        severity: "warning",
        title: `${side.team.name} ist nicht für diese Runde qualifiziert`,
        body: "Prüfe vor dem Speichern, ob die Auswahl beabsichtigt ist.",
        inline: side.fieldName === "team1" ? "team1-qualifikation" : "team2-qualifikation",
      });
    }
  }

  if (isBeingCalledOff) {
    banners.push({
      id: "spiel.canceled-meaning",
      severity: "danger",
      title: "Abgesagt heißt: das Spiel findet nicht statt",
      body: "Es erscheint überall als abgesagt und wird nicht mehr angemahnt. Ein eingetragenes Ergebnis bleibt stehen und zählt weiter für die Tabelle.",
      inline: "absage-bedeutung",
      supersedes: ["spiel.is-canceled"],
    });
  }

  if (isKnockout && isBeingCalledOff && dependentSpielNummern.length > 0) {
    const nummern = joinGerman(dependentSpielNummern);
    banners.push({
      id: "spiel.knockout-feeds",
      severity: "danger",
      title:
        dependentSpielNummern.length === 1 ? `Die Absage lässt Spiel ${nummern} unbesetzt` : `Die Absage lässt die Spiele ${nummern} unbesetzt`,
      body: "Ohne Ergebnis hier bleibt dort offen, wer antritt. Die Runden darunter ebenso.",
      inline: "absage-turnierbaum",
    });
  }

  if (isCanceled && hasDecidedErgebnis) {
    banners.push({
      id: "spiel.canceled-decided",
      severity: "warning",
      title: "Das Ergebnis zählt trotz Absage für die Tabelle",
      body: "Bei einer Wertung ist das beabsichtigt. Prüfe sonst, ob das Ergebnis hier stehen bleiben soll.",
      inline: "absage-wertung",
      supersedes: ["spiel.is-canceled"],
    });
  }

  if (isCanceled) {
    banners.push({
      id: "spiel.is-canceled",
      severity: "info",
      title: "Dieses Spiel wird nicht mehr angemahnt",
      body: "Es erscheint überall als abgesagt.",
      inline: null,
    });
  }

  if (voidedSpielNummern.length > 0) {
    const nummern = joinGerman(voidedSpielNummern);
    banners.push({
      id: "spiel.void-preview",
      severity: "danger",
      title:
        voidedSpielNummern.length === 1
          ? `Speichern löscht das Ergebnis in Spiel ${nummern}`
          : `Speichern löscht die Ergebnisse in den Spielen ${nummern}`,
      body: "Die Tore wurden von einer Mannschaft erzielt, die danach nicht mehr in diesem Spiel steht.",
      inline: null,
    });
  }

  if (releasedSpielNummern.length > 0) {
    const nummern = joinGerman(releasedSpielNummern);
    banners.push({
      id: "spiel.release-preview",
      severity: "warning",
      title:
        releasedSpielNummern.length === 1
          ? `Eine Mannschaft wird aus Spiel ${nummern} entfernt`
          : `Mannschaften werden aus den Spielen ${nummern} entfernt`,
      body: "Die Seite wird dort frei, denn eine Mannschaft spielt höchstens einmal pro Spieltag.",
      inline: null,
    });
  }

  return banners;
}
