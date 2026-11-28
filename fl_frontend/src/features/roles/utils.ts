import { AREA_COPY } from "@/core/copy/area";
import { COPY } from "@/core/copy/shared";
import { rolesOf } from "@/core/roles";
import { ROUTES } from "@/core/routes";

import type { Copy, Words } from "@/core/copy";
import type { FLSubjectSeat } from "@/core/generated/client/types";
import type { Role } from "@/core/roles";
import type { SubjectSession } from "@/core/subject";
import type { Route } from "next";

type Seat = Extract<Role, { kind: "kontakt" }>;

type Seasoned = Pick<FLSubjectSeat, "saison_id" | "saison_status">;

/**
 * The season a team's pages work in where the address names none the person holds there: the running one where they
 * hold a seat in it, else the newest they hold. The team frame's season button takes it by standard, and a contact's
 * place opens on it.
 */
export function standardSaisonOf(seats: readonly [Seasoned, ...Seasoned[]]): string {
  const newest = seats.reduce((best, seat) => (seat.saison_id.localeCompare(best.saison_id) > 0 ? seat : best));
  return (seats.find((seat) => seat.saison_status === "active") ?? newest).saison_id;
}

/** The person's contact seats on one team, of every season they hold there. */
const seatsOn = (roles: readonly Role[], teamId: string): Seat[] =>
  roles.flatMap((role) => (role.kind === "kontakt" && role.team_id === teamId ? [role] : []));

/**
 * The address one Funktion opens on. A team's is its Übersicht in the season its frame takes by standard, whatever
 * season the seat is of, so a contact seated on one team in two seasons holds one place there and switches season by
 * the frame's own button; a pupil's and a referee's carry no season, the person holding them across every one. Every
 * page of a place lies under its address, a team's under its Übersicht in one of the seasons held (`placeOf`'s
 * `parts`): the account menu marks a place by them.
 */
function roleHref(role: Role, roles: readonly Role[]): Route {
  switch (role.kind) {
    case "kontakt":
      // The seat stands among its team's seats again, which leaves the choice as it is and the list never empty.
      return ROUTES.teamOverview.path(role.team_id, standardSaisonOf([role, ...seatsOn(roles, role.team_id)]));
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
 * Grouped by address rather than listed per Funktion: two pupil rows on one mailbox, a Trainer who is also the
 * Ansprechperson, or seats on one team in two seasons lead to one page, and two links to it would read as two places.
 */
function targetsOf(roles: readonly Role[]): RoleTarget[] {
  const byHref = new Map<Route, [Role, ...Role[]]>();
  for (const role of roles) {
    const href = roleHref(role, roles);
    const held = byHref.get(href);
    if (held === undefined) byHref.set(href, [role]);
    else held.push(role);
  }

  return [...byHref].map(([href, held]) => ({ href, roles: held }));
}

/**
 * Where a person's landing sends them: Konto's list where they hold no place, the place where they hold one, whatever
 * kind it is, and the chooser where they hold several. Every way into the person area asks this, so a sign-in lands
 * where `/area` would send it without passing through it.
 */
export function landingTargetOf(targets: readonly RoleTarget[]): Route {
  const [first, ...rest] = targets;
  if (first === undefined) return ROUTES.account.path();
  return rest.length === 0 ? first.href : ROUTES.areaRoles.path();
}

export const placesOf = (subject: SubjectSession): RoleTarget[] => targetsOf(rolesOf(subject).roles);

/**
 * Whether the session's address holds a grant the session does not carry, past the administrator's window or short of
 * the passkey: it owes a fresh sign-in or its passkey step, which the sign-in's landing sends it on to, and is sent to no
 * person's place meanwhile.
 */
export function owesSignInStep(subject: SubjectSession): boolean {
  return !subject.isAdmin && subject.records.admin_tier !== null;
}

/** One season of a team's place: the Übersicht every page of the season lies under, and the line its account row shows there. */
type PlacePart = { href: Route; line: Copy };

/**
 * One naming for every list of a person's places: a team by its name in the season it opens on, with the seats held
 * there in any season, and one part per season held, which the frame's account row marks the place by and reads its
 * line from, the season's Kürzel and seats; the rest by their area.
 */
export function placeOf(target: RoleTarget): { href: Route; name: Words; seats?: Copy; parts?: readonly PlacePart[] } {
  const [first] = target.roles;
  const { href } = target;
  switch (first.kind) {
    case "kontakt": {
      // Every seat at one address shares its team; a club's name and Kürzel are a season's, so one seat a season names them.
      const seats = seatsOn(target.roles, first.team_id);
      const bySaison = new Map(seats.map((seat) => [seat.saison_id, seat]));
      const named = bySaison.get(standardSaisonOf([first, ...seats])) ?? first;
      const heldIn = (saison: string) => seats.filter((seat) => seat.saison_id === saison).map((seat) => seat.seat);
      return {
        href,
        name: { record: named.team_name },
        // A seat held in both seasons is one seat: the phrase names each once.
        seats: COPY.team.seatsHeld(seats.map((seat) => seat.seat)),
        parts: [...bySaison.values()].map((seat) => ({
          href: ROUTES.teamOverview.path(seat.team_id, seat.saison_id),
          line: AREA_COPY.team.accountLine({ record: seat.team_shorthand }, heldIn(seat.saison_id)),
        })),
      };
    }
    case "spieler":
      return { href, name: COPY.shared.spieler };
    case "schiedsrichter":
      return { href, name: COPY.shared.schiedsrichter };
    case "administration":
      return { href, name: COPY.shared.administration };
  }
}
