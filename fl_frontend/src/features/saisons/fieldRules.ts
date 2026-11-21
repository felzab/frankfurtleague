import "server-only";

import { requires } from "@/core/action";
import { SaisonsPatchSaisonBody, SaisonsPostSaisonBody } from "@/core/generated/zod/inputs";

const create = SaisonsPostSaisonBody.shape;

export const SAISON_CREATE_RULES = {
  required: {
    start: requires(create.start_date, ""),
    end: requires(create.end_date, ""),
  },
};

export type SaisonCreateRules = typeof SAISON_CREATE_RULES;

const patch = SaisonsPatchSaisonBody.shape;
const rules = patch.rules.shape;
// The application window is none or both of its days: what the window asks of each once it is set.
const bewerbung = patch.bewerbung.options[0].shape;

/**
 * The application window's two days are asked of a window that is set, which the editor marks once either holds a day;
 * the registration window's one day is optional as the window is.
 */
export const SAISON_SAVE_RULES = {
  required: {
    start_date: requires(patch.start_date, null),
    end_date: requires(patch.end_date, null),
    "bewerbung.start": requires(bewerbung.start, null),
    "bewerbung.end": requires(bewerbung.end, null),
    "rules.win_points": requires(rules.win_points, null),
    "rules.draw_points": requires(rules.draw_points, null),
    "rules.loss_points": requires(rules.loss_points, null),
    "rules.tiebreak_order": requires(rules.tiebreak_order, null),
    "rules.number_of_gruppen": requires(rules.number_of_gruppen, null),
    "rules.teams_per_gruppe": requires(rules.teams_per_gruppe, null),
    "rules.qualifiers_per_gruppe": requires(rules.qualifiers_per_gruppe, null),
    "rules.max_kader_size": requires(rules.max_kader_size, null),
    // An empty choice of Stufen is refused: the season admits at least one.
    "rules.allowed_stufen": requires(rules.allowed_stufen, []),
    "rules.forfeit_ergebnis.sieger_tore": requires(rules.forfeit_ergebnis.shape.sieger_tore, null),
    "rules.forfeit_ergebnis.verlierer_tore": requires(rules.forfeit_ergebnis.shape.verlierer_tore, null),
  },
};

export type SaisonSaveRules = typeof SAISON_SAVE_RULES;
