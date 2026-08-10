/**
 * ADMIN · context shape
 *
 * The four lookup lists the admin UI needs at once. This is the concrete reason `admin` is an
 * aggregator slice and imports across four others: no single slice owns them all, and threading them
 * through props from every route would be worse than the cross-slice import.
 *
 * Consumers of these lists — the Spiel edit form in particular — receive them as PROPS rather than
 * reading the context, so entity slices never depend on `admin`.
 *
 * `saisonSpiele` is the season's whole fixture list, and it exists here for the match picker: a
 * bracket source is picked from the season's legal feeder matches rather than typed as a number
 * (ADR-0038), and the edit dialog holds one match, not its season. It carries the same season the
 * `teams` list does, so on the one route that can show another season's matches the form checks the
 * `saison_id` before offering anything.
 */

import type { FLSchiedsrichter } from "../schiedsrichter/schemas";
import type { FLSpiel } from "../spiele/schemas";
import type { FLSpielort } from "../spielorte/schemas";
import type { FLTeam } from "../teams/schemas";

export interface AdminContext {
  spielorte: FLSpielort[];
  schiedsrichter: FLSchiedsrichter[];
  teams: FLTeam[];
  saisonSpiele: FLSpiel[];
}
