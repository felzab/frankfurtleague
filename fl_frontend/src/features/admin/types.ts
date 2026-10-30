import type { FLSchiedsrichter, FLSpielort, FLTeam } from "@/core/generated/client/types";
import type { FLSpiel } from "../spiele/types";

export interface AdminContext {
  spielorte: FLSpielort[];
  schiedsrichter: FLSchiedsrichter[];
  teams: FLTeam[];
  // The season's whole fixture list, for the bracket source picker: a feeder is picked from the
  // season's legal matches rather than typed, and the editor holds one match, not its season.
  saisonSpiele: FLSpiel[];
  // The season's own `rules.number_of_gruppen`, bounding the Herkunft group offer the way the write
  // path does (`wiring_gruppe_not_run`). `null` where no season resolves, and the picker then offers all.
  numberOfGroups: number | null;
  // Whether that season is `past`, so the draft preview promises no Termin a finished season cannot give.
  isFinishedSaison: boolean;
  // Whether that season is `active`, the only kind the confirmations' sweep asks about.
  isActiveSaison: boolean;
}
