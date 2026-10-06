import { createElement } from "react";
import { redirect } from "next/navigation";

import { funktionenOf } from "@/core/funktionen";
import { getSubjectSession } from "@/core/subject";
import { isFunktionLost } from "@/shared/utils/actionError";

import { TeamForbiddenPanel } from "./components/ui/TeamForbiddenPanel";
import { seatsAt } from "./teamSeats";

import type { SubjectSession } from "@/core/subject";
import type { ReactElement } from "react";
import type { TeamSeat } from "./teamSeats";

/**
 * The signed-in person, or a redirect to sign in (`docs/frontend/spec.md :: I377`). A layout's guard
 * does not rerun on a soft navigation, so a page reading `getSubjectSession` itself renders empty for
 * a lapsed session.
 */
export async function requireSubjectSession(): Promise<SubjectSession> {
  const subject = await getSubjectSession();
  if (subject === null) redirect("/signin");

  return subject;
}

/**
 * The seats held at a team page's own address, `null` where none stands and the page renders nothing
 * (`docs/frontend/spec.md :: I380`). Next runs a page whatever its layout renders in its stead, so
 * every team page calls this first.
 */
export async function requireTeamSeats(
  params: Promise<{ team_id: string; saison_id: string }>,
): Promise<readonly [TeamSeat, ...TeamSeat[]] | null> {
  const { team_id, saison_id } = await params;
  const [erster, ...weitere] = seatsAt(funktionenOf(await requireSubjectSession()).funktionen, team_id, saison_id);

  return erster === undefined ? null : [erster, ...weitere];
}

/**
 * The forbidden panel where the backend finds the seat gone after the page's own check
 * (`docs/frontend/spec.md :: I554`), as the shell answers a seat not held; every other failure
 * reaches the area's boundary.
 */
export async function readAsSeatHolder<T>(read: () => Promise<T>): Promise<{ data: T } | { forbidden: ReactElement }> {
  try {
    return { data: await read() };
  } catch (error) {
    if (!isFunktionLost(error)) throw error;
    // Built without JSX, the module keeping the name `docs/frontend/spec.md` sanctions for a slice's resolvers.
    return { forbidden: createElement(TeamForbiddenPanel, { funktionen: funktionenOf(await requireSubjectSession()).funktionen }) };
  }
}
