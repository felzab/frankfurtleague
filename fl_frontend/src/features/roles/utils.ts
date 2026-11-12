import { COPY } from "@/core/copy";
import { rolesOf } from "@/core/roles";
import { ROUTES } from "@/core/routes";

import type { Copy, Words } from "@/core/copy";
import type { Role } from "@/core/roles";
import type { SubjectSession } from "@/core/subject";
import type { Route } from "next";

/**
 * The address one Funktion opens on, which is also the address every page of that place lies under: the account menu
 * marks a place by it. A team's is its Übersicht in one season, a seat being a season's; a pupil's and a referee's
 * carry no season, the person holding them across every one.
 */
function roleHref(role: Role): Route {
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
export type RoleTarget = { href: Route; roles: readonly [Role, ...Role[]] };

/**
 * Grouped by address rather than listed per Funktion: two pupil rows on one mailbox, or a Trainer
 * who is also the Ansprechperson, lead to one page, and two links to it would read as two places.
 */
function targetsOf(roles: readonly Role[]): RoleTarget[] {
  const byHref = new Map<Route, [Role, ...Role[]]>();
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
export function landingTargetOf(targets: readonly RoleTarget[]): Route | null {
  const [first, ...rest] = targets;
  if (first === undefined) return ROUTES.account.path();
  return rest.length === 0 ? first.href : null;
}

export const placesOf = (subject: SubjectSession): RoleTarget[] => targetsOf(rolesOf(subject).roles);

/**
 * One naming for every list of a person's places: a team by its name, with its season and the seats held there, and the
 * line its frame's account row shows; the rest by their area.
 */
export function placeOf(target: RoleTarget): { href: Route; name: Words; seats?: Copy; teamLine?: Copy } {
  const [first] = target.roles;
  const { href } = target;
  switch (first.kind) {
    case "kontakt": {
      // Every seat at one address shares its team and season, so the first names both.
      const rollen = target.roles.flatMap((role) => (role.kind === "kontakt" ? [role.rolle] : []));
      return {
        href,
        name: { record: first.team_name },
        seats: COPY.account.role.seats(COPY.shared.saisonName(first.saison_id), rollen),
        teamLine: COPY.area.team.accountLine({ record: first.team_shorthand }, rollen),
      };
    }
    case "spieler":
      return { href, name: COPY.shared.spieler };
    case "schiedsrichter":
      return { href, name: COPY.shared.schiedsrichter };
    case "administration":
      return { href, name: COPY.admin.role };
  }
}
