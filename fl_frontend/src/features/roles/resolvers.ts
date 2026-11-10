import "server-only";

import { notFound, redirect } from "next/navigation";

import { withReturnAddress } from "@/core/auth/returnAddress";
import { APIBadStatusError } from "@/core/errors";
import { logRefused } from "@/core/refused";
import { isSeatAt, rolesOf } from "@/core/roles";
import { ROUTES } from "@/core/routes";
import { getSubjectSession } from "@/core/subject";

import type { Role } from "@/core/roles";
import type { SubjectSession } from "@/core/subject";
import type { PersonKind } from "./queries";

/**
 * The signed-in person a page at `path` under `/area` is drawn for, or a redirect to sign in carrying `path` back, as
 * the proxy's turn-away does. A page's alone, thrown inside its read: a frame reads `getSubjectSession` and draws no
 * account for `null`, since a redirect thrown in a frame unmounts it whole.
 * @awaitsPage the role chooser's page
 * @awaitsProduction the role chooser's page
 */
export async function requireSubjectSession(path: string): Promise<SubjectSession> {
  const subject = await getSubjectSession();
  if (subject === null) redirect(withReturnAddress(ROUTES.signIn.path(), path));
  return subject;
}

/**
 * The signed-in person a pupil's or a referee's page at `path` is drawn for. A person holding no such Funktion is
 * sent to the landing, never shown a refusal: the address exists, and the landing leads on to whatever they hold.
 */
export async function requireRole(kind: PersonKind, path: string): Promise<SubjectSession> {
  const subject = await requireSubjectSession(path);
  if (!rolesOf(subject).roles.some((role) => role.kind === kind)) {
    logRefused(`/area/${kind}`, "no_role");
    redirect(ROUTES.area.path());
  }
  return subject;
}

/** One contact seat a person holds, the only Funktion a team's pages answer to. */
export type TeamSeat = Extract<Role, { kind: "kontakt" }>;

/**
 * Every seat a person holds at one team page's address, at least one.
 * @awaitsPage the team's pages
 */
export type TeamSeats = readonly [TeamSeat, ...TeamSeat[]];

/** A team page's own address, built from its route's segments as its folders name them, `[team]/[saison]` first. */
type TeamAddress<Segments> = (segments: Segments) => string;

/**
 * The seats the signed-in person holds on exactly the team and season a team page's address names, `null` where they
 * hold none there; no session is sent to sign in, `address` carried back. For a page's metadata, which answers a
 * miss rather than throwing it (`fl_frontend/src/shared/utils/notFoundMetadata.ts :: metadataFor`).
 * @awaitsPage the team's pages
 * @awaitsProduction the team's pages
 */
export async function teamSeatsAt<Segments extends { team: string; saison: string }>(
  params: Promise<Segments>,
  address: TeamAddress<Segments>,
): Promise<TeamSeats | null> {
  const segments = await params;
  const subject = await requireSubjectSession(address(segments));
  // The predicate a person's write is judged by too: a seat on last season's row opens nothing in this one's.
  const [first, ...rest] = rolesOf(subject).roles.filter((role): role is TeamSeat => isSeatAt(role, segments.team, segments.saison));
  return first === undefined ? null : [first, ...rest];
}

/** Ends a team page's read on the card for a team the person holds no seat on. */
function refuseWithoutSeat(): never {
  logRefused("/area/team/[team]/[saison]", "no_seat");
  // The not-found boundary, which draws „Kein Zugang“ here (`fl_frontend/src/app/area/team/not-found.tsx`): Next's
  // own interrupt for a refused page, `forbidden()`, is experimental. Once it is stable, the change is this throw and
  // a `forbidden.tsx` beside that boundary.
  notFound();
}

/**
 * The seats a team page is drawn for, which every team page's read asks first: the layout stands above the team and
 * the season of the address and is handed neither, and Next runs a page whatever its frame draws. A person holding
 * no seat there ends on the frame's „Kein Zugang“ card.
 * @awaitsPage the team's pages
 * @awaitsProduction the team's pages
 */
export async function requireTeamSeats<Segments extends { team: string; saison: string }>(
  params: Promise<Segments>,
  address: TeamAddress<Segments>,
): Promise<TeamSeats> {
  return (await teamSeatsAt(params, address)) ?? refuseWithoutSeat();
}

/**
 * A team page's read of the backend, ending on the same card where the backend finds the seat gone after the page's
 * own check; every other failure reaches the frame's error card.
 * @awaitsPage the team's pages
 * @awaitsProduction the team's pages
 */
export async function readAsSeatHolder<Read>(read: () => Promise<Read>): Promise<Read> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof APIBadStatusError && error.serverErrorCode === "role_not_held") refuseWithoutSeat();
    throw error;
  }
}
