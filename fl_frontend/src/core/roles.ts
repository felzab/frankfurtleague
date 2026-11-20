import type { FLSaisonStatus, FLSubjectSeat } from "./generated/client/types";
import type { SubjectSession } from "./subject";

/**
 * One contact seat on a season that grants a panel, carrying the name and the Kürzel the club played that season
 * under and the season's first and last day.
 */
type KontaktRole = { kind: "kontakt" } & FLSubjectSeat;

type SpielerRole = { kind: "spieler"; spieler_id: string };

type SchiedsrichterRole = { kind: "schiedsrichter"; schiedsrichter_id: string };

/** Derived from the session's own verdict rather than the stored grant alone, which a code-borne session also holds. */
type AdministrationRole = { kind: "administration" };

/** What a person is on screen: one record the lookup matched, narrowed to what grants a panel. */
export type Role = KontaktRole | SpielerRole | SchiedsrichterRole | AdministrationRole;

// Held to the backend's own season predicate by a fixture both tiers' suites answer row by row.
export function grantsAPanel(status: FLSaisonStatus): boolean {
  // A switch rather than a comparison: a status added to the enum fails `tsc` here until somebody
  // decides whether it grants.
  switch (status) {
    case "active":
    case "future":
      return true;
    case "past":
      return false;
  }
}

/**
 * The contact seats on exactly this team in exactly this season, the one test a team page and a
 * person's write both judge by: a seat on last season's team opens nothing in this one's.
 */
export function seatsAt(roles: readonly Role[], teamId: string, saisonId: string): KontaktRole[] {
  return roles.filter((role) => role.kind === "kontakt").filter((seat) => seat.team_id === teamId && seat.saison_id === saisonId);
}

/**
 * The season is the one narrowing applied here. Confirmation is the lookup's alone, so `unconfirmed`
 * is passed through rather than recomputed: a second test of it would be a second definition of
 * "confirmed" for the two tiers to part on.
 */
export function rolesOf(subject: SubjectSession): { roles: Role[]; unconfirmed: boolean } {
  const { seats, spieler, schiedsrichter, unconfirmed } = subject.records;

  const roles: Role[] = [
    // Per seat and never per team: one junction row seats one person twice where the trainer is also
    // another seat, and each seat is its own Funktion.
    ...seats.filter((seat) => grantsAPanel(seat.saison_status)).map((seat): KontaktRole => ({ kind: "kontakt", ...seat })),
    // Neither row is season-scoped, so neither is narrowed.
    ...(spieler === null ? [] : [{ kind: "spieler", spieler_id: spieler.spieler_id } satisfies SpielerRole]),
    ...schiedsrichter.map((row): SchiedsrichterRole => ({ kind: "schiedsrichter", schiedsrichter_id: row.schiedsrichter_id })),
    ...(subject.isAdmin ? [{ kind: "administration" } satisfies AdministrationRole] : []),
  ];

  return { roles, unconfirmed };
}
