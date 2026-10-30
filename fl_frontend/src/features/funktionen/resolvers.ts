import { createElement } from "react";
import { redirect } from "next/navigation";

import { rolesOf } from "@/core/funktionen";
import { getSubjectSession } from "@/core/subject";
import { isFunktionLost } from "@/shared/utils/actionError";

import { TeamForbiddenPanel } from "./components/ui/TeamForbiddenPanel";
import { seatsAt } from "./teamSeats";

import type { SubjectSession } from "@/core/subject";
import type { ReactElement } from "react";
import type { TeamSeat } from "./teamSeats";

/**
 * The signed-in person, or a redirect to sign in: a page's alone, thrown
 * inside its segment. The frame reads `getSubjectSession` and answers `null` with its fallback, a redirect
 * there unmounting it whole.
 */
export async function requireSubjectSession(): Promise<SubjectSession> {
  const subject = await getSubjectSession();
  if (subject === null) redirect("/signin");

  return subject;
}

/**
 * The seats held at a team page's own address, `null` where none stands and the page renders nothing.
 * Next runs a page whatever its layout renders in its stead, so
 * every team page calls this first.
 */
export async function requireTeamSeats(
  params: Promise<{ team_id: string; saison_id: string }>,
): Promise<readonly [TeamSeat, ...TeamSeat[]] | null> {
  const { team_id, saison_id } = await params;
  const [erster, ...weitere] = seatsAt(rolesOf(await requireSubjectSession()).roles, team_id, saison_id);

  return erster === undefined ? null : [erster, ...weitere];
}

/**
 * The forbidden panel where the backend finds the seat gone after the page's own check,
 * as the shell answers a seat not held; every other failure
 * reaches the area's boundary.
 */
export async function readAsSeatHolder<T>(read: () => Promise<T>): Promise<{ data: T } | { forbidden: ReactElement }> {
  try {
    return { data: await read() };
  } catch (error) {
    if (!isFunktionLost(error)) throw error;
    // Built without JSX, the module keeping the name for a slice's resolvers.
    return { forbidden: createElement(TeamForbiddenPanel, { funktionen: rolesOf(await requireSubjectSession()).roles }) };
  }
}
