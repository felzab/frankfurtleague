import "server-only";

import { carryAccount } from "@/core/auth";
import { logger } from "@/core/logging";

import { getAdresswechselUmzuege, postAdresswechselUmzuegeErledigt } from "./mutations";

/**
 * Carries every sign-in account an effect still owes to its new address, a page at a time, and takes each off its
 * change. Behind a confirmation's or an approval's response, and in the hourly pass for an answer either lost. A
 * carry moves the account once, so a second run finds none to move; a failure rejects, the rest waiting for the
 * next run.
 */
export async function runAdresswechselUmzuege(): Promise<void> {
  for (;;) {
    const { moves: umzuege } = await getAdresswechselUmzuege();
    if (umzuege.length === 0) return;

    for (const { von, nach } of umzuege) {
      // The new address holding its own account, opened since every press refused one there: it signs in to that one.
      if ((await carryAccount(von, nach)) === "belegt") logger.warn("address_change.account_not_moved", { grund: "occupied" });
    }
    await postAdresswechselUmzuegeErledigt({ ids: umzuege.map(({ id }) => id) });
  }
}
