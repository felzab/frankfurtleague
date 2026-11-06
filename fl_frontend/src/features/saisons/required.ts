import "server-only";

import { requires } from "@/core/action";
import { SaisonsPatchSaisonBody, SaisonsPostSaisonBody } from "@/core/generated/zod/inputs";

const create = SaisonsPostSaisonBody.shape;

/** What the create asks of the dialog's two boxes, read on the server so its schema never reaches the browser. */
export const CREATE_REQUIRED = {
  start: requires(create.start_date, ""),
  end: requires(create.end_date, ""),
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
  start: requires(patch.start_date, null),
  end: requires(patch.end_date, null),
  bewerbungStart: requires(bewerbung.start, null),
  bewerbungEnd: requires(bewerbung.end, null),
  winPoints: requires(rules.win_points, null),
  drawPoints: requires(rules.draw_points, null),
  lossPoints: requires(rules.loss_points, null),
  tiebreak: requires(rules.tiebreak_order, null),
  gruppen: requires(rules.number_of_gruppen, null),
  teamsPerGruppe: requires(rules.teams_per_gruppe, null),
  qualifiers: requires(rules.qualifiers_per_gruppe, null),
  maxKader: requires(rules.max_kader_size, null),
  // An empty choice of Stufen is refused: the season admits at least one.
  stufen: requires(rules.allowed_stufen, []),
  forfeitWinner: requires(rules.forfeit_ergebnis.shape.sieger_tore, null),
  forfeitLoser: requires(rules.forfeit_ergebnis.shape.verlierer_tore, null),
};

export type SaisonRequired = typeof SAISON_REQUIRED;
