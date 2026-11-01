import type { FLKontaktRolle, FLSaisonStatus } from "./generated/client/types";
import type { SubjectSession } from "./subject";

/** One contact seat on a season that grants a panel, carrying the name the club PLAYED that season under. */
type KontaktRole = {
  art: "kontakt";
  // The contact-seat sense of the word, never the captaincy's.
  rolle: FLKontaktRolle;
  team_id: string;
  saison_id: string;
  team_name: string;
  saison_status: FLSaisonStatus;
};

type SpielerRole = { art: "spieler"; spieler_id: string };

type SchiedsrichterRole = { art: "schiedsrichter"; schiedsrichter_id: string };

/** Derived from the session's own verdict rather than the stored grant alone, which a code-borne session also holds. */
type AdministrationRole = { art: "administration" };

/** What a person IS on screen: one record the lookup matched, narrowed to what grants a panel. */
export type Role = KontaktRole | SpielerRole | SchiedsrichterRole | AdministrationRole;

// Held to the backend's own season predicate by `fl_backend/tests/shared/grants_a_panel.json`, which
// both tiers' suites answer row by row.
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
 * A contact seat on exactly this team in exactly this season, the one predicate a team page and a
 * person's write both judge by: a seat on last season's team opens nothing in this one's.
 */
export function isSeatAt(role: Role, teamId: string, saisonId: string): role is KontaktRole {
  return role.art === "kontakt" && role.team_id === teamId && role.saison_id === saisonId;
}

/**
 * The season is the one narrowing applied here. Confirmation is the lookup's alone, so `unconfirmed`
 * is passed through rather than recomputed: a second test of it would be a second definition of
 * "confirmed" for the two tiers to part on.
 */
export function rolesOf(subject: SubjectSession): { roles: Role[]; unconfirmed: boolean } {
  const { seats, spieler, schiedsrichter, unconfirmed } = subject.subject;

  const roles: Role[] = [
    // Per seat and never per team: one junction row seats one person twice where the trainer is also
    // another seat, and each seat is its own Funktion.
    ...seats
      .filter((seat) => grantsAPanel(seat.saison_status))
      .map((seat): KontaktRole => ({
        art: "kontakt",
        rolle: seat.rolle,
        team_id: seat.team_id,
        saison_id: seat.saison_id,
        team_name: seat.team_name,
        saison_status: seat.saison_status,
      })),
    // Neither row is season-scoped, so neither is narrowed.
    ...spieler.map((row): SpielerRole => ({ art: "spieler", spieler_id: row.spieler_id })),
    ...schiedsrichter.map((row): SchiedsrichterRole => ({ art: "schiedsrichter", schiedsrichter_id: row.schiedsrichter_id })),
    ...(subject.admin ? [{ art: "administration" } satisfies AdministrationRole] : []),
  ];

  return { roles: roles, unconfirmed: unconfirmed };
}
