import type { FLSchiedsrichter } from "../schiedsrichter/schemas";
import type { FLSpiel } from "../spiele/schemas";
import type { FLSpielort } from "../spielorte/schemas";
import type { FLTeam } from "../teams/schemas";

export interface AdminContext {
  spielorte: FLSpielort[];
  schiedsrichter: FLSchiedsrichter[];
  teams: FLTeam[];
  // The season's whole fixture list, for the bracket source picker: a feeder is picked from the
  // season's legal matches rather than typed, and the editor holds one match, not its season.
  saisonSpiele: FLSpiel[];
  // The season's own `rules.number_of_groups`, bounding the Herkunft group offer the way the write
  // path does (`REQ-WIRING-003`). `null` where no season resolves, and the picker then offers all.
  numberOfGroups: number | null;
}
