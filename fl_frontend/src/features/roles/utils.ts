import { ROUTES } from "@/core/routes";

import type { Role } from "@/core/roles";

/** A team's area, the team and the season being its whole address. */
function teamHref(teamId: string, saisonId: string): string {
  return `/area/team/${teamId}/${saisonId}`;
}

/** The address one Funktion opens on. */
function roleHref(role: Role): string {
  switch (role.kind) {
    case "kontakt":
      return teamHref(role.team_id, role.saison_id);
    case "spieler":
      return "/area/spieler";
    case "schiedsrichter":
      return "/area/schiedsrichter";
    case "administration":
      return ROUTES.admin.path();
  }
}

/** One address a person's Funktionen lead to, with every one of them that leads there. */
export type RoleTarget = { href: string; roles: readonly [Role, ...Role[]] };

/**
 * Grouped by address rather than listed per Funktion: two pupil rows on one mailbox, or a Trainer
 * who is also the Ansprechperson, lead to one page, and two links to it would read as two places.
 */
export function targetsOf(roles: readonly Role[]): RoleTarget[] {
  const byHref = new Map<string, [Role, ...Role[]]>();
  for (const role of roles) {
    const href = roleHref(role);
    const held = byHref.get(href);
    if (held === undefined) byHref.set(href, [role]);
    else held.push(role);
  }

  return [...byHref].map(([href, held]) => ({ href, roles: held }));
}

/**
 * The team a person's landing sends them straight on to, or `null` where the Übersicht stands: a team's own landing
 * is one, so a lone team goes straight on, and any other lone place is one card of the Übersicht. Every way into the
 * person area asks this, so a sign-in lands where `/area` would send it.
 */
export function soleTeamOf(targets: readonly RoleTarget[]): string | null {
  const [first, ...rest] = targets;
  return first !== undefined && rest.length === 0 && first.roles[0].kind === "kontakt" ? first.href : null;
}
