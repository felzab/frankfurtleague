import "server-only";

import { liveSessionsOf } from "@/core/auth/accountSessions";
import { endedByItsAccount, isWithinPersonLifetime } from "@/core/auth/sessionStamps";

/**
 * Counts this device too. The person lifetime holds for an administrator's address too: the person area admits their
 * session that long, so the widest guard decides; a row the account's last ending stamped, whose deletion failed, signs
 * in nothing and is not counted.
 */
export async function devicesOf(served: { readonly user: { readonly id: string } & object }): Promise<number> {
  const rows = await liveSessionsOf(served.user.id);
  return rows.filter((row) => isWithinPersonLifetime(row) && !endedByItsAccount({ user: served.user, session: row })).length;
}
