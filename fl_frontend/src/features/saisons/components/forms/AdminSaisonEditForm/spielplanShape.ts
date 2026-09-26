import { buildSpielplanVorschau } from "@/features/saisons/utils";

import { spielplanPress, spielplanReplacesDraw } from "./blockedReasons";

import type { FLSaisonRules, FLSaisonStatus, FLSpielplanShape } from "@/features/saisons/schemas";
import type { SaisonGruppenOccupancy, SaisonSpielplanContext } from "@/features/saisons/types";
import type { SpielplanControlInput, SpielplanOperation } from "./blockedReasons";

/**
 * One of the three, as the panel both offers and reads it back. No bounds: two of the three have
 * none, their legal values skipping (`fl_frontend/src/features/saisons/shapeOffer.ts`), and the third
 * derives its own from those two.
 */
export type ShapeField = { key: keyof FLSpielplanShape; label: string };

/**
 * The three the fixture list is a function of, in the panel's order. **One table for the fields and
 * the confirmation both**, so no readout can label a number differently from the field above it.
 */
export const SHAPE_FIELDS: readonly ShapeField[] = [
  { key: "number_of_groups", label: "Gruppen" },
  { key: "teams_per_group", label: "Teams pro Gruppe" },
  { key: "qualifiers_per_group", label: "Qualifikanten pro Gruppe" },
];

/** The season's stored three: what a replace starts from, and what a first draw leaves untouched. */
export function readShape(rules: FLSaisonRules): FLSpielplanShape {
  return {
    number_of_groups: rules.number_of_groups,
    teams_per_group: rules.teams_per_group,
    qualifiers_per_group: rules.qualifiers_per_group,
  };
}

/** One row of the armed readout. `isChanged` is what makes a redraw a rules change as well as a draw. */
export type ShapeRow = { key: keyof FLSpielplanShape; label: string; value: string; isChanged: boolean };

/**
 * The armed confirmation's rows, one per rule. **A moved number is stated FROM and TO**: the draw
 * stores it, so a bare new value would hide that the season's shape moved.
 *
 * Prose rather than an arrow glyph, which a screen reader announces as nothing.
 */
export function describeShapeRows(stored: FLSpielplanShape, next: FLSpielplanShape): ShapeRow[] {
  return SHAPE_FIELDS.map(({ key, label }) => ({
    key,
    label,
    value: stored[key] === next[key] ? String(next[key]) : `von ${String(stored[key])} auf ${String(next[key])}`,
    isChanged: stored[key] !== next[key],
  }));
}

/** The season as the Spielplan panel is decided from it: every value stored, never the editor's draft. */
export type SpielplanPanelSeason = {
  saisonStatus: FLSaisonStatus;
  rules: FLSaisonRules;
  startDate: string;
  endDate: string;
  gruppenOccupancy: SaisonGruppenOccupancy;
  hasDrawnSpiele: boolean;
} & SaisonSpielplanContext;

/** One input for the panel and for the editor counting its typing, so the two cannot judge different offers. */
export function buildSpielplanControlInput(season: SpielplanPanelSeason): SpielplanControlInput {
  const vorschau = buildSpielplanVorschau(season.schedule);

  return {
    saisonStatus: season.saisonStatus,
    hasSpielplan: season.spielplan !== null,
    hasDrawnSpiele: season.hasDrawnSpiele,
    spieltageCount: season.spieltageCount,
    erfassteSpieleCount: season.bestand.erfasst,
    hasKoRunden: vorschau.koRunden.length > 0,
    startDate: season.startDate,
    endDate: season.endDate,
    vorschauSpieltage: vorschau.spieltage,
    gruppen: { groups: season.rules.number_of_groups, teams: season.rules.teams_per_group, occupancy: season.gruppenOccupancy },
  };
}

/** The redraw's typing: the operation picked and the three boxes, which the season's save never sends. */
export type RedrawDraft = {
  /** Null until the admin picks: each write destroys the same rows, so a preselection would arm the operation nobody read. */
  picked: SpielplanOperation | null;
  shape: FLSpielplanShape;
};

/** Nothing picked, and the boxes on the stored three. */
export function startingRedraw(rules: FLSaisonRules): RedrawDraft {
  return { picked: null, shape: readShape(rules) };
}

/**
 * How many of the three boxes stand moved, counted as the editor counts its own unsaved changes. None where the
 * pick hides them: a leave dialog counting values no reader can see would be unexplainable.
 */
export function movedShapeCount(season: SpielplanPanelSeason, redraw: RedrawDraft): number {
  const input = buildSpielplanControlInput(season);
  const offered = spielplanReplacesDraw(input) && spielplanPress({ input, picked: redraw.picked, shape: redraw.shape }).operation === "anlegen";

  return offered ? describeShapeRows(readShape(season.rules), redraw.shape).filter((row) => row.isChanged).length : 0;
}
