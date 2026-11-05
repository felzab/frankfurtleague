import "server-only";

import { SaisonsPatchSaisonBody, SaisonsPostSaisonBody } from "@/core/generated/zod/inputs";

/**
 * A field is required where the write refuses it empty: an untouched box posts "", a cleared count or day nothing, a
 * choice of several answers none.
 */
const required = (field: { safeParse: (value: unknown) => { success: boolean } }, empty: "" | null | readonly []) =>
  !field.safeParse(empty).success;

const create = SaisonsPostSaisonBody.shape;

/** What the create asks of the dialog's three boxes, read on the server so its schema never reaches the browser. */
export const CREATE_REQUIRED = {
  id: required(create.id, ""),
  start: required(create.start_date, ""),
  end: required(create.end_date, ""),
};

const patch = SaisonsPatchSaisonBody.shape;
const rules = patch.rules.shape;
// The application window is none or both of its days: what the window asks of each once it is set.
const bewerbung = patch.bewerbung.options[0].shape;

/**
 * What the season write asks of each of the editor's boxes. The application window's two days are asked of a window
 * that is set, which the editor marks once either holds a day; the registration window's one day is optional as the
 * window is.
 */
export const SAISON_REQUIRED = {
  start: required(patch.start_date, null),
  end: required(patch.end_date, null),
  bewerbungStart: required(bewerbung.start, null),
  bewerbungEnd: required(bewerbung.end, null),
  winPoints: required(rules.win_points, null),
  drawPoints: required(rules.draw_points, null),
  tiebreak: required(rules.tiebreak_order, null),
  gruppen: required(rules.number_of_gruppen, null),
  teamsPerGruppe: required(rules.teams_per_gruppe, null),
  qualifiers: required(rules.qualifiers_per_gruppe, null),
  maxKader: required(rules.max_kadergroesse, null),
  // An empty choice of Stufen is refused: the season admits at least one.
  stufen: required(rules.allowed_stufen, []),
  forfeitWinner: required(rules.forfeit_ergebnis.shape.sieger_tore, null),
  forfeitLoser: required(rules.forfeit_ergebnis.shape.verlierer_tore, null),
};

export type SaisonRequired = typeof SAISON_REQUIRED;
