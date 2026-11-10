import { ContractBreakError } from "@/core/errors";

import type { FLErasureSweepResponse } from "@/core/generated/client/types";

/**
 * Every call of one pass summed, the last answered call's season and remainder beside the sums. A pass reaches each
 * person once, so the sums count persons; one who failed stays due for the next pass.
 */
type ErasureSum = Omit<FLErasureSweepResponse, "after">;

/** A pass that ended on a call's answer, or on a call that threw: what remains is then unknown. */
export type ErasureSweep = (ErasureSum & { abgebrochen: false }) | (Omit<ErasureSum, "remaining"> & { abgebrochen: true; error: unknown });

// A loop and no request, so outside `mutations.ts`, whose every export is one request.
/**
 * One pass, each call handed the `after` the call before it answered. Settles rather than throws, so a caller words
 * what the calls before a failure erased.
 */
export async function sweepErasure(run: (after: string | null) => Promise<FLErasureSweepResponse>): Promise<ErasureSweep> {
  let total: ErasureSum = {
    completed_saison_id: null,
    spieler: 0,
    saison_spieler: 0,
    registrierungen: 0,
    skipped: 0,
    failed: 0,
    remaining: 0,
  };

  try {
    let after: string | null = null;
    do {
      const response = await run(after);
      total = {
        completed_saison_id: response.completed_saison_id,
        spieler: total.spieler + response.spieler,
        saison_spieler: total.saison_spieler + response.saison_spieler,
        registrierungen: total.registrierungen + response.registrierungen,
        skipped: total.skipped + response.skipped,
        failed: total.failed + response.failed,
        remaining: response.remaining,
      };

      // A place not past the one sent would loop for ever, the hourly pass skipping every tick behind it; fixed-length
      // hex compares in id order.
      if (after !== null && response.after !== null && response.after <= after) {
        throw new ContractBreakError("The deletion answered a place not past the one it was sent.");
      }

      // The pass's one end: `remaining` counts a failing person, who stays due, and a call erasing nobody may stand
      // in front of a due person the next call reaches.
      after = response.after;
    } while (after !== null);
  } catch (error) {
    const { remaining: _unknown, ...previous } = total;
    return { ...previous, abgebrochen: true, error };
  }

  return { ...total, abgebrochen: false };
}
