import "server-only";

import { redirect } from "next/navigation";

import { getAccountSession } from "@/core/auth/guards";
import { withReturnAddress } from "@/core/auth/returnAddress";
import { COPY } from "@/core/copy";
import { rolesOf } from "@/core/roles";
import { ROUTES } from "@/core/routes";
import { getSubjectSession } from "@/core/subject";
import { targetsOf } from "@/features/roles/utils";

import type { JudgedSession } from "@/core/auth/guards";
import type { Copy } from "@/core/copy";
import type { SubjectSession } from "@/core/subject";
import type { RoleTarget } from "@/features/roles/utils";
import type { Account } from "@/kit/FrameNav";
import type { Route } from "next";

/** One place a person's Funktionen open on, as „Funktion wechseln“ lists it: a team by its name, the rest by their area. */
function entryOf(target: RoleTarget): NonNullable<Account["roles"]>[number] {
  const [first] = target.roles;
  // An address built from the person's own records, which no literal can spell.
  const href = target.href as Route;
  switch (first.kind) {
    case "kontakt": {
      // Every seat at one address shares its team and season, so the first names both.
      const rollen = target.roles.flatMap((role) => (role.kind === "kontakt" ? [role.rolle] : []));
      // Session 8: the place carries its own line for the account row, `COPY.area.team.accountLine` over the seat's Kürzel.
      return {
        href,
        label: { record: first.team_name },
        detail: COPY.account.role.seats(COPY.shared.saisonName(first.saison_id), rollen),
      };
    }
    case "spieler":
      return { href, label: COPY.shared.spieler };
    case "schiedsrichter":
      return { href, label: COPY.shared.schiedsrichter };
    case "administration":
      return { href, label: COPY.admin.role };
  }
}

/**
 * The person signed in as a frame's account row shows them: their address, `role` the area's line under it, which an
 * area that is no one role's leaves out, and every place their Funktionen open on; `null` for no session, whose page
 * sends it on. The menu marks the place the page lies under (`fl_frontend/src/kit/FrameNav.tsx :: AccountMenu`), since
 * a team's layout cannot name its team.
 */
export async function readAccount(role?: Copy): Promise<Account | null> {
  const subject = await getSubjectSession();
  if (subject === null) return null;
  return {
    role,
    address: { record: subject.email },
    roles: targetsOf(rolesOf(subject).roles).map(entryOf),
  };
}

/**
 * Where Konto's „‹ Zurück“ leads, the person's Übersicht, or `null` for a person holding no Funktion: the Übersicht
 * sends that person to Konto, so a way back there would lead straight back here. Read off the session the account
 * row's read shares, which costs no request of its own.
 */
export async function readAreaBack(): Promise<Route | null> {
  const subject = await getSubjectSession();
  return subject !== null && rolesOf(subject).roles.length === 0 ? null : ROUTES.area.path();
}

/**
 * The signed-in person a Konto page at `path` is drawn for, and the session it is drawn under, or a redirect carrying
 * `path` back, as the proxy's turn-away does: to sign in for no session, and to the landing for an address holding a
 * grant whose session the administrator's lane refuses, which owes a fresh sign-in or its passkey step before its
 * account's acts (`fl_frontend/src/core/auth/guards.ts :: getAccountSession`), the landing sending it there. Thrown
 * inside the page, as a page's turn-away is. Both guards share this render's one session read and one lookup.
 */
export async function requireAccountSession(path: string): Promise<{ subject: SubjectSession; served: JudgedSession }> {
  const subject = await getSubjectSession();
  if (subject === null) redirect(withReturnAddress(ROUTES.signIn.path(), path));
  const served = await getAccountSession();
  if (served === null) redirect(withReturnAddress(ROUTES.signInLanding.path(), path));
  return { subject, served };
}
