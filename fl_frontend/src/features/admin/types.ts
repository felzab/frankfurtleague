/**
 * ADMIN · context shape
 *
 * The three lookup lists the admin UI needs at once. This is the concrete reason `admin` is an
 * aggregator slice and imports across four others: no single slice owns all three, and threading them
 * through props from every route would be worse than the cross-slice import.
 *
 * Consumers of these lists — the Spiel edit form in particular — receive them as PROPS rather than
 * reading the context, so entity slices never depend on `admin`.
 */

import type { FLSchiedsrichter } from "../schiedsrichter/schemas";
import type { FLSpielort } from "../spielorte/schemas";
import type { FLTeam } from "../teams/schemas";

export interface AdminContext {
  spielorte: FLSpielort[];
  schiedsrichter: FLSchiedsrichter[];
  teams: FLTeam[];
}
