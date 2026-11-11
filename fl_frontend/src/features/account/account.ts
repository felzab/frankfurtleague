import "server-only";

import { redirect } from "next/navigation";

import { getAccountSession } from "@/core/auth/guards";
import { withReturnAddress } from "@/core/auth/returnAddress";
import { rolesOf } from "@/core/roles";
import { ROUTES } from "@/core/routes";
import { getSubjectSession } from "@/core/subject";
import { placeOf, placesOf } from "@/features/roles/utils";

import type { JudgedSession } from "@/core/auth/guards";
import type { Copy } from "@/core/copy";
import type { SubjectSession } from "@/core/subject";
import type { RoleTarget } from "@/features/roles/utils";
import type { Account } from "@/kit/FrameNav";
import type { Route } from "next";

/**
 * One place a person's Funktionen open on, as „Funktion wechseln“ lists it; a team's carries the account row's second
 * line on every page of its season, which a team's frame cannot name itself.
 */
function entryOf(target: RoleTarget): NonNullable<Account["roles"]>[number] {
  const { href, name, seats, teamLine } = placeOf(target);
  return { href, label: name, ...(seats === undefined ? {} : { detail: seats }), ...(teamLine === undefined ? {} : { role: teamLine }) };
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
    roles: placesOf(subject).map(entryOf),
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
