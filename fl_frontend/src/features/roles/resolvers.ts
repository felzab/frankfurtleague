import "server-only";

import { redirect } from "next/navigation";

import { withReturnAddress } from "@/core/auth/returnAddress";
import { refusedAs } from "@/core/errors";
import { logRefused } from "@/core/refused";
import { rolesOf, seatsAt } from "@/core/roles";
import { ROUTES } from "@/core/routes";
import { getSubjectSession } from "@/core/subject";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import type { Code } from "@/core/generated/client/types";
import type { Role } from "@/core/roles";
import type { SubjectSession } from "@/core/subject";
import type { Metadata } from "next";
import type { PersonKind } from "./queries";

/**
 * The signed-in person a page at `path` under `/area` is drawn for, or a redirect to sign in carrying `path` back, as
 * the proxy's turn-away does. A page's alone, thrown inside its read: a frame reads `getSubjectSession` and draws no
 * account for `null`, since a redirect thrown in a frame unmounts it whole.
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

export type TeamSeats = readonly [TeamSeat, ...TeamSeat[]];

/** A team page's own address, built from its route's segments as its folders name them, `[team]/[saison]` first. */
type TeamAddress<Segments> = (segments: Segments) => string;

/**
 * The seats the signed-in person holds on exactly the team and season a team page's address names, `null` where they
 * hold none there; no session is sent to sign in, `address` carried back.
 */
async function teamSeatsAt<Segments extends { team: string; saison: string }>(
  params: Promise<Segments>,
  address: TeamAddress<Segments>,
): Promise<TeamSeats | null> {
  const segments = await params;
  const subject = await requireSubjectSession(address(segments));
  // The test a person's write is judged by too: a seat on last season's row opens nothing in this one's.
  const [first, ...rest] = seatsAt(rolesOf(subject).roles, segments.team, segments.saison);
  return first === undefined ? null : [first, ...rest];
}

/**
 * A team page's metadata off the page's own read, `read` for the seat the person holds at its address, memoised by the
 * page so the tab and the page share it: `metadataOf` what it found, and the not-found title where it found nothing,
 * where the person holds no seat there, or where the backend finds the seat gone after the session's check, the page
 * itself sending such a person on to the landing. It answers each miss rather than throwing it, so the turn-away is
 * the page's alone and logged once, and a failed read as `metadataFor` does.
 */
export async function teamMetadata<Segments extends { team: string; saison: string }, Read>(
  params: Promise<Segments>,
  address: TeamAddress<Segments>,
  read: (seat: TeamSeat) => Promise<Read | null>,
  metadataOf: (found: Read) => Promise<Metadata> | Metadata,
): Promise<Metadata> {
  const outcome = teamSeatsAt(params, address).then(async (seats) => {
    if (seats === null) return null;
    try {
      return await read(seats[0]);
    } catch (error) {
      if (isRoleGone(error)) return null;
      throw error;
    }
  });
  return metadataFor(outcome, metadataOf);
}

/** A person holding no seat at a team page's address is sent to the landing, as `requireRole` sends a pupil or a referee. */
function refuseWithoutSeat(): never {
  logRefused("/area/team/[team]/[saison]", "no_seat");
  redirect(ROUTES.area.path());
}

/**
 * The seats a team page is drawn for, which every team page's read asks first: the layout stands above the team and
 * the season of the address and is handed neither, and Next runs a page whatever its frame draws. A person holding
 * no seat there is sent to the landing, never shown a refusal: the landing leads on to whatever they hold.
 */
export async function requireTeamSeats<Segments extends { team: string; saison: string }>(
  params: Promise<Segments>,
  address: TeamAddress<Segments>,
): Promise<TeamSeats> {
  return (await teamSeatsAt(params, address)) ?? refuseWithoutSeat();
}

const ROLE_GONE: ReadonlySet<Code> = new Set<Code>(["role_not_held"]);

/** Whether the backend refused a read because the person's Funktion went after the page's own check. */
export const isRoleGone = (error: unknown): boolean => refusedAs(error, ROLE_GONE);

/**
 * A pupil's or a referee's page's read of the backend, sending the person on to the landing where the backend finds
 * the Funktion gone after the page's own check, as `requireRole` sends a person holding none; every other failure
 * reaches the frame's error card.
 */
export async function readAsRoleHolder<Read>(kind: PersonKind, read: () => Promise<Read>): Promise<Read> {
  try {
    return await read();
  } catch (error) {
    if (!isRoleGone(error)) throw error;
    logRefused(`/area/${kind}`, "no_role");
    redirect(ROUTES.area.path());
  }
}

/**
 * A team page's read of the backend, sending the person on to the landing where the backend finds the seat gone after
 * the page's own check, as a person holding none is sent; every other failure reaches the frame's error card.
 */
export async function readAsSeatHolder<Read>(read: () => Promise<Read>): Promise<Read> {
  try {
    return await read();
  } catch (error) {
    if (isRoleGone(error)) refuseWithoutSeat();
    throw error;
  }
}
