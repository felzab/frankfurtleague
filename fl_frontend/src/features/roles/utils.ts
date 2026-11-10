import { ROUTES } from "@/core/routes";

import type { Role } from "@/core/roles";

/**
 * The address one Funktion opens on, which is also the address every page of that place lies under: the account menu
 * marks a place by it (`fl_frontend/src/kit/FrameNav.tsx :: AccountMenu`). A team's is its Übersicht in one season,
 * a seat being a season's; a pupil's and a referee's carry no season, the person holding them across every one.
 */
function roleHref(role: Role): string {
  switch (role.kind) {
    case "kontakt":
      return ROUTES.teamOverview.path(role.team_id, role.saison_id);
    case "spieler":
      return ROUTES.areaSpieler.path();
    case "schiedsrichter":
      return ROUTES.areaSchiedsrichter.path();
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
 * Where a person's landing sends them straight on to: Konto's list where they hold no place, the place where they hold
 * one, whatever kind it is; `null` where they hold several, which the landing lists. Every way into the person area
 * asks this, so a sign-in lands where `/area` would send it without passing through it.
 */
export function landingTargetOf(targets: readonly RoleTarget[]): string | null {
  const [first, ...rest] = targets;
  if (first === undefined) return ROUTES.account.path();
  return rest.length === 0 ? first.href : null;
}
