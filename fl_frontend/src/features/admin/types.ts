import type { FLSchiedsrichter } from "../schiedsrichter/schemas";
import type { FLSpielort } from "../spielorte/schemas";
import type { FLTeam } from "../teams/schemas";

export interface AdminContext {
  spielorte: FLSpielort[];
  schiedsrichter: FLSchiedsrichter[];
  teams: FLTeam[];
}
