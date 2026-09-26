import { redirect } from "next/navigation";

import { funktionenOf } from "@/core/funktionen";
import { getSubjectSession } from "@/core/subject";

import { seatsAt } from "./teamSeats";

import type { SubjectSession } from "@/core/subject";
import type { TeamSeat } from "./teamSeats";

/**
 * The signed-in person, or a redirect to sign in: every person and team page reads its subject here
 * (`docs/frontend/spec.md :: I377`). A layout's guard does not rerun on a soft navigation, so a page
 * reading `getSubjectSession` itself renders empty for a lapsed session rather than sending it on.
 */
export async function requireSubjectSession(): Promise<SubjectSession> {
  const subject = await getSubjectSession();
  if (subject === null) redirect("/signin");

  return subject;
}

/**
 * The seats the person holds at a team page's own address, `null` where none stands: such a page
 * renders and reads nothing (`docs/frontend/spec.md :: I380`). Called by every team page before any
 * read, since Next runs a page whatever its layout renders in its stead.
 */
export async function requireTeamSeats(
  params: Promise<{ team_id: string; saison_id: string }>,
): Promise<readonly [TeamSeat, ...TeamSeat[]] | null> {
  const { team_id, saison_id } = await params;
  const [erster, ...weitere] = seatsAt(funktionenOf(await requireSubjectSession()).funktionen, team_id, saison_id);

  return erster === undefined ? null : [erster, ...weitere];
}
