import type { FLSubjektSitz } from "./schemas";
import type { SubjectSession } from "./subject";

/** One contact seat on a season that grants a panel, carrying the name the club PLAYED that season under. */
type KontaktFunktion = {
  art: "kontakt";
  // The contact-seat sense of the word, never the captaincy's.
  rolle: FLSubjektSitz["rolle"];
  team_id: string;
  saison_id: string;
  team_name: string;
  saison_status: FLSubjektSitz["saison_status"];
};

type SpielerFunktion = { art: "spieler"; spieler_id: string };

type SchiedsrichterFunktion = { art: "schiedsrichter"; schiedsrichter_id: string };

/** Derived from the session's own verdict and never served: the allowlist is no record a mailbox matches. */
type AdministrationFunktion = { art: "administration" };

/** What a person IS on screen: one record the lookup matched, narrowed to what grants a panel. */
export type Funktion = KontaktFunktion | SpielerFunktion | SchiedsrichterFunktion | AdministrationFunktion;

// Held to the backend's own season predicate by `fl_backend/tests/shared/grants_a_panel.json`, which
// both tiers' suites answer row by row.
export function grantsAPanel(status: FLSubjektSitz["saison_status"]): boolean {
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
 * The season is the one narrowing applied here. Confirmation is the lookup's alone, so `unbestaetigt`
 * is passed through rather than recomputed: a second test of it would be a second definition of
 * "confirmed" for the two tiers to part on.
 */
export function funktionenOf(subject: SubjectSession): { funktionen: Funktion[]; unbestaetigt: boolean } {
  const { sitze, spieler, schiedsrichter, unbestaetigt } = subject.subjekt;

  const funktionen: Funktion[] = [
    // Per seat and never per team: one junction row seats one person twice where the trainer is also
    // another seat, and each seat is its own Funktion.
    ...sitze
      .filter((sitz) => grantsAPanel(sitz.saison_status))
      .map((sitz): KontaktFunktion => ({
        art: "kontakt",
        rolle: sitz.rolle,
        team_id: sitz.team_id,
        saison_id: sitz.saison_id,
        team_name: sitz.team_name,
        saison_status: sitz.saison_status,
      })),
    // Neither row is season-scoped, so neither is narrowed.
    ...spieler.map((row): SpielerFunktion => ({ art: "spieler", spieler_id: row.spieler_id })),
    ...schiedsrichter.map((row): SchiedsrichterFunktion => ({ art: "schiedsrichter", schiedsrichter_id: row.schiedsrichter_id })),
    ...(subject.admin ? [{ art: "administration" } satisfies AdministrationFunktion] : []),
  ];

  return { funktionen: funktionen, unbestaetigt: unbestaetigt };
}
