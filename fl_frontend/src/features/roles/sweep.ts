import "server-only";

import { deleteAccountFor, listAccounts } from "@/core/auth/accounts";
import { requestOf } from "@/core/errors";
import { logger } from "@/core/logging";

import { postReferences } from "./mutations";

/**
 * The most addresses one references read judges, mirroring the backend's `REFERENCES_ADDRESSES_MAX`
 * (`fl_backend/app/shared/schemas/bounds.py`): a larger batch is refused whole, every pass alike.
 */
export const REFERENCES_ADDRESSES_MAX = 250;

/** What one pass did, by count and never by address: the scheduler's pass line is all that records it. */
type AccountSweepCount = {
  unreferenced: number;
  deleted: number;
  already_deleted: number;
  failed: number;
};

/**
 * One pass over every sign-in account, deleting those no record references, for the scheduler
 * (`fl_frontend/src/instrumentationNode.ts :: armScheduler`), which runs one pass at a time. A store that lists
 * nothing rejects, for the heartbeat to name; the pass resolves to what it did, `open` the accounts it could not judge
 * or delete.
 */
export async function runAccountSweep(): Promise<{ count: AccountSweepCount; open: number }> {
  const accounts = await listAccounts();
  const count: AccountSweepCount = { unreferenced: 0, deleted: 0, already_deleted: 0, failed: 0 };

  // Batch by batch, each within the read's ceiling: a larger one, or an empty one, is refused whole,
  // every pass alike, and the sweep would then delete nothing ever after.
  for (let start = 0; start < accounts.length; start += REFERENCES_ADDRESSES_MAX) {
    const batch = accounts.slice(start, start + REFERENCES_ADDRESSES_MAX);
    let unreferenced: readonly string[];

    try {
      ({ unreferenced } = await postReferences({ identifiers: batch }));
    } catch (error) {
      // Kept, every one: an answer that never came says nothing about any address in it.
      count.failed += batch.length;
      logAccountFailure("account.references_failed", error, batch.length);
      continue;
    }

    count.unreferenced += unreferenced.length;
    // One at a time: each delete is a transaction of its own, and its ask is meant to come just before it.
    for (const address of unreferenced) {
      await deleteUnreferencedAccount(address, count);
    }
  }

  return { count, open: count.failed };
}

/** One account, deleted only where the read answers its address unreferenced again, alone. */
async function deleteUnreferencedAccount(address: string, count: AccountSweepCount): Promise<void> {
  try {
    // Asked again immediately before the delete rather than trusted from the batch: a record entered
    // since then keeps its account, and the race narrows to the seconds between this answer and the delete.
    const { unreferenced } = await postReferences({ identifiers: [address] });
    if (!unreferenced.includes(address)) return;

    if (await deleteAccountFor(address)) count.deleted += 1;
    else count.already_deleted += 1;
  } catch (error) {
    count.failed += 1;
    logAccountFailure("account.delete_failed", error);
  }
}

/** The step and the error's name, never the address: a failure on this path routinely carries it. */
function logAccountFailure(event: "account.references_failed" | "account.delete_failed", error: unknown, batchSize?: number): void {
  logger.error(event, undefined, {
    name: error instanceof Error ? error.name : undefined,
    ...requestOf(error),
    count: batchSize,
  });
}
