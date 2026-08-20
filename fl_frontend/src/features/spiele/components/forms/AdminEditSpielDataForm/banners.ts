import type { FLSonderereignis, FLSpielQuelle, FLSpielTeamField } from "@/features/spiele/schemas";
import type { RailBanner } from "@/shared/components/ui/railBanner";

export type SpielBannerId =
  | "spiel.team1-manual"
  | "spiel.team2-manual"
  | "spiel.team1-unqualified"
  | "spiel.team2-unqualified"
  | "spiel.sonderereignis-meaning"
  | "spiel.knockout-feeds"
  | "spiel.result-refused"
  | "spiel.forfeit-awarded"
  | "spiel.abandoned-decided"
  | "spiel.sonderereignis-standing"
  | "spiel.void-preview"
  | "spiel.release-preview";

export type SpielBannerSpot =
  | "team1-manuell"
  | "team2-manuell"
  | "team1-qualifikation"
  | "team2-qualifikation"
  | "sonderereignis-bedeutung"
  | "sonderereignis-turnierbaum"
  | "sonderereignis-wertung";

export type SpielBanner = RailBanner<SpielBannerId> & { inline: SpielBannerSpot | null };

/** One side of the fixture as the draft holds it — the shape both per-side banners are built from. */
export type SpielBannerSide = {
  fieldName: "team1" | "team2";
  label: string;
  quelle: FLSpielQuelle | null;
  team: FLSpielTeamField | null;
};

/**
 * What the chosen event does, in the admin's words. **Per member and never one sentence for all
 * five**: the consequence differs, and the single warning this replaced was false for the members it
 * did not describe.
 */
const SONDEREREIGNIS_MEANING: Record<FLSonderereignis, { title: string; body: string }> = {
  ausgefallen: {
    title: "Ausgefallen heißt: das Spiel findet nicht statt",
    body: "Es wird nirgends gewertet und nicht mehr angemahnt. Ein Ergebnis darf nicht daran stehen.",
  },
  nichtantreten_team1: {
    title: "Nichtantreten heißt: Team 1 ist nicht erschienen",
    body: "Das Spiel wird beim Speichern nach den Regeln der Saison für Team 2 gewertet und zählt voll für die Tabelle.",
  },
  nichtantreten_team2: {
    title: "Nichtantreten heißt: Team 2 ist nicht erschienen",
    body: "Das Spiel wird beim Speichern nach den Regeln der Saison für Team 1 gewertet und zählt voll für die Tabelle.",
  },
  abgebrochen: {
    title: "Abgebrochen heißt: das Spiel hat stattgefunden",
    body: "Es wird weiter wie ein gespieltes Spiel behandelt: ohne Ergebnis wird es angemahnt, mit Ergebnis zählt es ganz normal mit.",
  },
  annulliert: {
    title: "Annulliert heißt: das Spiel zählt nicht mehr",
    body: "Es wird nirgends gewertet und nicht mehr angemahnt. Ein Ergebnis darf nicht daran stehen.",
  },
};

/** A list of fixture numbers as German writes it: "29, 30 und 31", with "und" and no serial comma. */
export const joinGerman = (spielNummern: readonly number[]): string =>
  new Intl.ListFormat("de-DE", { style: "long", type: "conjunction" }).format(spielNummern.map(String));

export function buildSpielBanners({
  isKnockout,
  sides,
  knockoutTeamIds,
  isNewlyChosen,
  sonderereignis,
  dependentSpielNummern,
  hasAnyTore,
  hasDecidedErgebnis,
  voidedSpielNummern,
  releasedSpielNummern,
}: {
  isKnockout: boolean;
  sides: readonly SpielBannerSide[];
  /** Every team the bracket already fields — the client's proxy for "qualified". */
  knockoutTeamIds: ReadonlySet<string>;
  /**
   * THIS edit moves the event at all. **A swap counts**: what the fixture does afterwards changes as
   * much as acquiring a first event does. A drop falls out on the `null` check below.
   */
  isNewlyChosen: boolean;
  sonderereignis: FLSonderereignis | null;
  /** Fixtures whose occupants this one's result decides, empty where it decides none. */
  dependentSpielNummern: readonly number[];
  /** Any goal count typed at all — `REQ-STATE-002`'s subject, which is not the decided-result one. */
  hasAnyTore: boolean;
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

  if (isNewlyChosen && sonderereignis !== null) {
    banners.push({
      id: "spiel.sonderereignis-meaning",
      severity: "danger",
      title: SONDEREREIGNIS_MEANING[sonderereignis].title,
      body: SONDEREREIGNIS_MEANING[sonderereignis].body,
      inline: "sonderereignis-bedeutung",
      supersedes: ["spiel.sonderereignis-standing"],
    });
  }

  // **This set is the bracket's alone**: only a member that can never carry a result leaves the slot
  // below unfilled. A no-show is awarded a result and an abandonment may still be scored, so each of
  // those resolves the bracket rather than stalling it.
  if (
    isKnockout &&
    isNewlyChosen &&
    (sonderereignis === "ausgefallen" || sonderereignis === "annulliert") &&
    dependentSpielNummern.length > 0
  ) {
    const nummern = joinGerman(dependentSpielNummern);
    banners.push({
      id: "spiel.knockout-feeds",
      severity: "danger",
      title:
        dependentSpielNummern.length === 1
          ? `Ohne Wertung bleibt Spiel ${nummern} unbesetzt`
          : `Ohne Wertung bleiben die Spiele ${nummern} unbesetzt`,
      body: "Ohne Ergebnis hier bleibt dort offen, wer antritt. Die Runden darunter ebenso.",
      inline: "sonderereignis-turnierbaum",
    });
  }

  // A CONTRADICTION rather than a doubtful combination: `find_state_refusal` answers `REQ-STATE-002`
  // and the save never lands. Its subject is any typed goal, not a decided scoreline.
  if ((sonderereignis === "ausgefallen" || sonderereignis === "annulliert") && hasAnyTore) {
    banners.push({
      id: "spiel.result-refused",
      severity: "danger",
      title: "Ein nicht gewertetes Spiel kann kein Ergebnis tragen",
      body: "Der Server lehnt das Speichern ab. Entferne zuerst die Tore, oder wähle ein anderes Sonderereignis.",
      inline: "sonderereignis-wertung",
      supersedes: ["spiel.sonderereignis-standing"],
    });
  }

  // The forfeit is composed on the server from the season's rules, so the numbers are stated nowhere
  // on this page. Typed goals raise it to a warning, which is what makes the save confirm: those
  // goals are somebody's work and the award replaces them.
  if (sonderereignis === "nichtantreten_team1" || sonderereignis === "nichtantreten_team2") {
    banners.push({
      id: "spiel.forfeit-awarded",
      severity: hasAnyTore ? "warning" : "info",
      title: hasAnyTore ? "Die eingetragenen Tore werden durch die Wertung ersetzt" : "Das Ergebnis wird beim Speichern gewertet",
      body: "Ein Nichtantreten wird nach den Regeln der Saison für die angetretene Mannschaft gewertet; die Tore trägt der Server ein.",
      inline: "sonderereignis-wertung",
      supersedes: ["spiel.sonderereignis-standing"],
    });
  }

  // **The one member for which "does this result belong here?" is a real question.** An abandoned
  // fixture may legitimately keep the score it reached, or may be waiting for a replay.
  if (sonderereignis === "abgebrochen" && hasDecidedErgebnis) {
    banners.push({
      id: "spiel.abandoned-decided",
      severity: "warning",
      title: "Das Ergebnis zählt trotz Abbruch für die Tabelle",
      body: "Bei einer Wertung ist das beabsichtigt. Prüfe sonst, ob das Ergebnis hier stehen bleiben soll.",
      inline: "sonderereignis-wertung",
    });
  }

  // **This set is the standing note's alone**, and `abgebrochen` is absent from it: an abandoned
  // fixture is still chased for its result and still reads by date, so neither half of this is true
  // of it.
  if (sonderereignis !== null && sonderereignis !== "abgebrochen") {
    banners.push({
      id: "spiel.sonderereignis-standing",
      severity: "info",
      title: "Dieses Spiel wird nicht mehr angemahnt",
      body: "Es erscheint überall als abgesagt und steht nur noch zum Nachschlagen.",
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
