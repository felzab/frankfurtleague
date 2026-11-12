import "server-only";

import { notFound, redirect } from "next/navigation";

import { withReturnAddress } from "@/core/auth/returnAddress";
import { APIBadStatusError } from "@/core/errors";
import { logRefused } from "@/core/refused";
import { isSeatAt, rolesOf } from "@/core/roles";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getSubjectSession } from "@/core/subject";
import { metadataFor, NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";

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
  // The predicate a person's write is judged by too: a seat on last season's row opens nothing in this one's.
  const [first, ...rest] = rolesOf(subject).roles.filter((role): role is TeamSeat => isSeatAt(role, segments.team, segments.saison));
  return first === undefined ? null : [first, ...rest];
}

/** A team page's tab where the person holds no seat at its address: the title of the card the page draws there. */
const FORBIDDEN_METADATA: Metadata = { ...NOT_FOUND_METADATA, title: SERVER_COPY.area.forbidden };

/**
 * A team page's metadata off the page's own read, `read` for the seat the person holds at its address, memoised by the
 * page so the tab and the card share it: `metadataOf` what it found; the not-found title where it found nothing; and
 * the „Kein Zugang“ card's title where the person holds no seat there, or the backend finds the seat gone after the
 * session's check, so the tab says what the card says. It answers each miss rather than throwing
 * it, since a `notFound()` thrown from `generateMetadata` leaves the tab the layout's title, and a failed read as
 * `metadataFor` does.
 */
export async function teamMetadata<Segments extends { team: string; saison: string }, Read>(
  params: Promise<Segments>,
  address: TeamAddress<Segments>,
  read: (seat: TeamSeat) => Promise<Read | null>,
  metadataOf: (found: Read) => Promise<Metadata> | Metadata,
): Promise<Metadata> {
  // Wrapped, so a forbidden address reaches the forbidden title here rather than `metadataFor`'s not-found one.
  const outcome = teamSeatsAt(params, address).then(async (seats) => {
    if (seats === null) return { forbidden: true } as const;
    try {
      const found = await read(seats[0]);
      return found === null ? null : { found };
    } catch (error) {
      if (isRoleGone(error)) return { forbidden: true } as const;
      throw error;
    }
  });
  return metadataFor(outcome, (known) => ("forbidden" in known ? FORBIDDEN_METADATA : metadataOf(known.found)));
}

function refuseWithoutSeat(): never {
  logRefused("/area/team/[team]/[saison]", "no_seat");
  // The team area's not-found boundary draws „Kein Zugang“ here: Next's own interrupt for a refused page,
  // `forbidden()`, is experimental. Once it is stable, the change is this throw and
  // a `forbidden.tsx` beside that boundary.
  notFound();
}

/**
 * The seats a team page is drawn for, which every team page's read asks first: the layout stands above the team and
 * the season of the address and is handed neither, and Next runs a page whatever its frame draws. A person holding
 * no seat there ends on the frame's „Kein Zugang“ card.
 */
export async function requireTeamSeats<Segments extends { team: string; saison: string }>(
  params: Promise<Segments>,
  address: TeamAddress<Segments>,
): Promise<TeamSeats> {
  return (await teamSeatsAt(params, address)) ?? refuseWithoutSeat();
}

/** Whether the backend refused a read because the person's Funktion went after the page's own check. */
export const isRoleGone = (error: unknown): boolean => error instanceof APIBadStatusError && error.serverErrorCode === "role_not_held";

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
 * A team page's read of the backend, ending on the same card where the backend finds the seat gone after the page's
 * own check; every other failure reaches the frame's error card.
 */
export async function readAsSeatHolder<Read>(read: () => Promise<Read>): Promise<Read> {
  try {
    return await read();
  } catch (error) {
    if (isRoleGone(error)) refuseWithoutSeat();
    throw error;
  }
}
