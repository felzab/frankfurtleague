import type { Funktion } from "@/core/funktionen";

/** One contact seat a person holds, the only Funktion a team's area answers to. */
export type TeamSeat = Extract<Funktion, { art: "kontakt" }>;

/**
 * The seats held on exactly this team in exactly this season. Both halves of the address, never the
 * team alone: a seat on last season's team opens nothing in this one's.
 */
export function seatsAt(funktionen: readonly Funktion[], teamId: string, saisonId: string): TeamSeat[] {
  return funktionen.filter(
    (funktion): funktion is TeamSeat => funktion.art === "kontakt" && funktion.team_id === teamId && funktion.saison_id === saisonId,
  );
}

/** A team's area, the team and the season being its whole address. */
export function teamHref(teamId: string, saisonId: string): string {
  return `/bereich/team/${teamId}/${saisonId}`;
}
