import { isSeatAt } from "@/core/roles";

import type { Role } from "@/core/roles";

/** One contact seat a person holds, the only Funktion a team's area answers to. */
export type TeamSeat = Extract<Role, { art: "kontakt" }>;

/** The seats held on exactly this team in exactly this season, by the predicate a person's write is judged by too. */
export function seatsAt(funktionen: readonly Role[], teamId: string, saisonId: string): TeamSeat[] {
  return funktionen.filter((funktion): funktion is TeamSeat => isSeatAt(funktion, teamId, saisonId));
}

/** A team's area, the team and the season being its whole address. */
export function teamHref(teamId: string, saisonId: string): string {
  return `/bereich/team/${teamId}/${saisonId}`;
}
