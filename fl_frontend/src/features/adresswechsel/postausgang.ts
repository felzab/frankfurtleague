import "server-only";

import { requestOf } from "@/core/errors";
import { logger } from "@/core/logging";

import { postAdresswechselPostausgang, postAdresswechselZugestellt } from "./mutations";
import { adresswechselWirksam, mailAdresswechselNichtWirksam } from "./notifications";

import type { FLAdresswechselPostausgangZeile } from "./schemas";

/**
 * Whether a drain is running, and whether an end arrived while it ran, per module instance: the claim hands a second
 * drain none of the first's rows, so a press arriving mid-drain queues one more round rather than racing it.
 */
let laeuft = false;
let nochmal = false;

/**
 * Delivers every notice an address change's end still owes, claimed from the outbox the end wrote
 * (`docs/backend/spec.md :: I838`). Settles rather than throws: a confirmation and an approval run it behind their
 * response, the hourly pass after its calls.
 */
export async function runAdresswechselPostausgang(): Promise<void> {
  if (laeuft) {
    nochmal = true;
    return;
  }

  laeuft = true;
  try {
    do {
      nochmal = false;
      // A claim holds a page: the next page until a claim holds none, or a page is left undelivered for its lease.
      let weiter = true;
      while (weiter) weiter = await zustellen();
    } while (nochmal);
  } finally {
    laeuft = false;
  }
}

/** Claim, deliver, then stamp what was delivered, answering whether the claim held anything. */
async function zustellen(): Promise<boolean> {
  let claim;
  try {
    claim = await postAdresswechselPostausgang();
  } catch (error) {
    logPostausgangFailure("adresswechsel.postausgang_failed", error);
    return false;
  }

  if (claim.beanspruchung === null || claim.mitteilungen.length === 0) return false;

  const zugestellt: string[] = [];
  for (const mitteilung of claim.mitteilungen) {
    if (await zustellenEine(mitteilung)) zugestellt.push(mitteilung.id);
  }

  // Nothing delivered: the rest wait for the lease to lapse, never claimed again inside this drain.
  if (zugestellt.length === 0) return false;

  try {
    await postAdresswechselZugestellt({ beanspruchung: claim.beanspruchung, ids: zugestellt });
  } catch (error) {
    // Left for the next claim once this one lapses: the notice goes again, and the account's carry finds nothing left.
    logPostausgangFailure("adresswechsel.stempel_failed", error);
    return false;
  }

  return zugestellt.length === claim.mitteilungen.length;
}

/** One owed notice, answering whether it is done with: delivered, refused for good, or given up. */
async function zustellenEine(mitteilung: FLAdresswechselPostausgangZeile): Promise<boolean> {
  // Given up by the backend's count (`docs/backend/spec.md :: I480`): stamped undelivered rather than claimed for ever,
  // and this line is all that says who was never told, by its kind and never by address.
  if (mitteilung.aufgegeben) {
    logger.error("adresswechsel.notice_abandoned", undefined, { error_code: "FE-MAIL-016", art: mitteilung.art });
    return true;
  }

  if (mitteilung.art === "verworfen") {
    return mailAdresswechselNichtWirksam({ operation: "runAdresswechselPostausgang", email: mitteilung.email });
  }

  return adresswechselWirksam({ operation: "runAdresswechselPostausgang", mitteilung: mitteilung });
}

/** Which half stopped, the error's name and what the call says of its request, never a person. */
function logPostausgangFailure(event: "adresswechsel.postausgang_failed" | "adresswechsel.stempel_failed", error: unknown): void {
  logger.error(event, undefined, { error_code: "FE-SWEEP-005", name: error instanceof Error ? error.name : undefined, ...requestOf(error) });
}
