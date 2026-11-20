import "server-only";

import type { FLGrantWaitHours, FLOwnerWaitDays, FLSubjectResponse } from "./generated/client/types";

/** How long an addition waits, and a handover. */
export const GRANT_WAIT = { hours: 24 } as const satisfies { hours: FLGrantWaitHours };
export const OWNER_WAIT = { days: 7 } as const satisfies { days: FLOwnerWaitDays };

/**
 * The grant an address holds in effect, its tier and when it took effect, as the subject lookup serves them: null
 * together for none. Read per request and never stamped on a session, which a removal or a handover would outlive.
 */
export type Grant = Pick<FLSubjectResponse, "admin_tier" | "granted_since">;

/**
 * Whether a session made at `made` is no older than `since`: a privilege holds for sessions made since it
 * alone, judged here because ending older sessions at the change misses one written in the database.
 */
export function madeSince(made: Date | string, since: string | null): boolean {
  const created = new Date(made).getTime();
  const at = since === null ? Number.NaN : new Date(since).getTime();

  // An unreadable instant on either side admits nobody.
  return Number.isFinite(created) && Number.isFinite(at) && created >= at;
}
