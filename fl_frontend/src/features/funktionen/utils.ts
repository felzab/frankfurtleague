import { ROUTES } from "@/core/routes";

import type { Role } from "@/core/roles";

/** A team's area, the team and the season being its whole address. */
function teamHref(teamId: string, saisonId: string): string {
  return `/area/team/${teamId}/${saisonId}`;
}

/** The address one Funktion opens on. */
function funktionHref(funktion: Role): string {
  switch (funktion.kind) {
    case "kontakt":
      return teamHref(funktion.team_id, funktion.saison_id);
    case "spieler":
      return "/area/spieler";
    case "schiedsrichter":
      return "/area/schiedsrichter";
    case "administration":
      return ROUTES.admin.path();
  }
}

/** One address a person's Funktionen lead to, with every one of them that leads there. */
export type FunktionZiel = { href: string; funktionen: readonly [Role, ...Role[]] };

/**
 * Grouped by address rather than listed per Funktion: two pupil rows on one mailbox, or a Trainer
 * who is also the Ansprechperson, lead to one page, and two links to it would read as two places.
 */
export function zieleOf(funktionen: readonly Role[]): FunktionZiel[] {
  const byHref = new Map<string, [Role, ...Role[]]>();
  for (const funktion of funktionen) {
    const href = funktionHref(funktion);
    const held = byHref.get(href);
    if (held === undefined) byHref.set(href, [funktion]);
    else held.push(funktion);
  }

  return [...byHref].map(([href, held]) => ({ href, funktionen: held }));
}

/**
 * The team a person's landing sends them straight on to, or `null` where the Übersicht stands: a team's own landing
 * is one, so a lone team goes straight on, and any other lone place is one card of the Übersicht. Every way into the
 * person area asks this, so a sign-in lands where `/area` would send it.
 */
export function soleTeamOf(ziele: readonly FunktionZiel[]): string | null {
  const [first, ...rest] = ziele;
  return first !== undefined && rest.length === 0 && first.funktionen[0].kind === "kontakt" ? first.href : null;
}
