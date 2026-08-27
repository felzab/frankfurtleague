import type { FLSonderereignis, FLSpielQuelle, FLSpielTeamField } from "@/features/spiele/schemas";
import type { RailBanner } from "@/shared/components/ui/railBanner";

export type SpielBannerId =
  | "spiel.eligibility-refused"
  | "spiel.spieltag-refused"
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
 * five**: the consequence differs, and one sentence for all of them is false for most of them. The
 * picker above spells the member's own name, so neither line here repeats it.
 */
const SONDEREREIGNIS_MEANING: Record<FLSonderereignis, { title: string; body?: string }> = {
  ausgefallen: {
    title: "Das Spiel findet nicht statt",
    body: "Es wird nirgends gewertet und nicht mehr angemahnt.",
  },
  nichtantreten_team1: {
    title: "Team 1 ist nicht angetreten",
    body: "Das Spiel wird nach den Regeln der Saison für Team 2 gewertet.",
  },
  nichtantreten_team2: {
    title: "Team 2 ist nicht angetreten",
    body: "Das Spiel wird nach den Regeln der Saison für Team 1 gewertet.",
  },
  // The title is the whole entry: what a reader gets wrong here is that an abandonment changes
  // nothing about the scoring, and a body would state that a second time.
  abgebrochen: { title: "Das Spiel zählt weiter wie ein gespieltes" },
  annulliert: {
    title: "Das Spiel zählt rückwirkend nicht mehr",
    body: "Es wird nirgends gewertet und nicht mehr angemahnt.",
  },
};

/** The refusal codes whose remedies ride the rail rather than the one field message they land on. */
export type SpielRefusalCode = "REQ-ELIGIBILITY-001" | "REQ-SPIELTAG-001";

/** The half a one-sentence field message cannot carry: the rule the refusal rests on, and the repair. */
const REFUSAL_REMEDIES: Record<SpielRefusalCode, { id: SpielBannerId; title: string; body: string }> = {
  "REQ-ELIGIBILITY-001": {
    id: "spiel.eligibility-refused",
    title: "Ein ausgeschiedenes Team blockiert das Speichern",
    body: "Der Austritt zählt auch, wenn nur Datum oder Sonderereignis geändert wurde. Hebe den Austritt auf, oder wähle ein anderes Team.",
  },
  "REQ-SPIELTAG-001": {
    id: "spiel.spieltag-refused",
    title: "Im anderen Spiel wird diese Seite automatisch besetzt",
    body: "Ein Team spielt höchstens einmal pro Spieltag. Ändere dort die Herkunft, um das Team freizugeben, oder wähle hier ein anderes Team.",
  },
};

/** Narrows a server error code onto the two the rail answers, so the caller stores no other. */
export const isSpielRefusalCode = (code: string | undefined): code is SpielRefusalCode =>
  code !== undefined && Object.hasOwn(REFUSAL_REMEDIES, code);

// Derived from the remedies, never listed again: a third refusal added above would otherwise reach
// the rail and be forgotten here.
const REFUSAL_BANNER_IDS: ReadonlySet<SpielBannerId> = new Set(Object.values(REFUSAL_REMEDIES).map((remedy) => remedy.id));

/** Whether this banner reports a refusal already delivered, rather than a consequence a save would cause. */
export const isSpielRefusalBannerId = (id: SpielBannerId): boolean => REFUSAL_BANNER_IDS.has(id);

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
  dropsShootOut,
  voidedSpielNummern,
  releasedSpielNummern,
  refusalCode,
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
  /** An entered shoot-out this save discards. Work of the admin's, so it is named rather than dropped. */
  dropsShootOut: boolean;
  /** Fixtures the dry run says this save takes a stored result from, never ones that merely could. */
  voidedSpielNummern: readonly number[];
  releasedSpielNummern: readonly number[];
  /**
   * The refusal the last save came back with, `null` once the draft moves off the inputs that were
   * judged — the caller's staleness rule, so a corrected draft never carries the old remedies.
   */
  refusalCode: SpielRefusalCode | null;
}): readonly SpielBanner[] {
  const banners: SpielBanner[] = [];

  // The field message states the value's own fault in one sentence, the register `docs/frontend/spec.md`
  // §1.12 sets. What to DO about it needs more room than that allows, so it rides here instead.
  if (refusalCode !== null) {
    banners.push({ ...REFUSAL_REMEDIES[refusalCode], severity: "danger", inline: null });
  }

  for (const side of sides) {
    if (!isKnockout || side.quelle !== null) continue;

    banners.push({
      id: side.fieldName === "team1" ? "spiel.team1-manual" : "spiel.team2-manual",
      severity: "danger",
      title: `${side.label} setzt Du von Hand`,
      inline: side.fieldName === "team1" ? "team1-manuell" : "team2-manuell",
    });

    if (side.team !== null && !knockoutTeamIds.has(side.team.team_id)) {
      banners.push({
        id: side.fieldName === "team1" ? "spiel.team1-unqualified" : "spiel.team2-unqualified",
        severity: "warning",
        title: `${side.team.name} ist nicht für diese Runde qualifiziert`,
        body: "Prüfe, ob die Auswahl beabsichtigt ist.",
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
      body: "Entferne zuerst die Tore, oder wähle ein anderes Sonderereignis.",
      inline: "sonderereignis-wertung",
      supersedes: ["spiel.sonderereignis-standing"],
    });
  }

  // Raised only where the award REPLACES somebody's work, which is also what makes the save confirm.
  // A bare no-show destroys nothing, and the meaning entry above already states the award.
  if ((sonderereignis === "nichtantreten_team1" || sonderereignis === "nichtantreten_team2") && (hasAnyTore || dropsShootOut)) {
    banners.push({
      id: "spiel.forfeit-awarded",
      severity: "warning",
      title: dropsShootOut
        ? "Die Wertung ersetzt das Ergebnis und verwirft das Elfmeterschießen"
        : "Die eingetragenen Tore werden durch die Wertung ersetzt",
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
      body: "Prüfe, ob das Ergebnis hier stehen bleiben soll.",
      inline: "sonderereignis-wertung",
    });
  }

  // **This set is the standing note's alone**, and `abgebrochen` is absent from it: an abandoned
  // fixture is still chased for its result, so this would be false of it.
  if (sonderereignis !== null && sonderereignis !== "abgebrochen") {
    banners.push({
      id: "spiel.sonderereignis-standing",
      severity: "info",
      title: "Dieses Spiel wird nicht mehr angemahnt",
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
      inline: null,
    });
  }

  if (releasedSpielNummern.length > 0) {
    const nummern = joinGerman(releasedSpielNummern);
    banners.push({
      id: "spiel.release-preview",
      severity: "warning",
      title:
        releasedSpielNummern.length === 1 ? `Ein Team wird aus Spiel ${nummern} entfernt` : `Teams werden aus den Spielen ${nummern} entfernt`,
      inline: null,
    });
  }

  return banners;
}
