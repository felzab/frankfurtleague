import { ContractBreakError } from "@/core/errors";

import type { FLLoeschungLaufResponse } from "./schemas";

/**
 * Every call of one pass summed, the last answered call's season and remainder beside the sums. A pass reaches each
 * person once, so the sums count persons; one who failed stays due for the next pass.
 */
type LoeschungSumme = Omit<FLLoeschungLaufResponse, "acknowledged" | "nach">;

/** A pass that ended on a call's answer, or on a call that threw: what remains is then unknown. */
export type LoeschungLauf =
  (LoeschungSumme & { abgebrochen: false }) | (Omit<LoeschungSumme, "verbleibend"> & { abgebrochen: true; fehler: unknown });

// A loop and no request, so outside `mutations.ts`, whose every export the step-up reader takes for one
// (`fl_frontend/src/shared/testing/stepUpWrites.ts`).
/**
 * One pass, each call handed the `nach` the call before it answered. Settles rather than throws, so a caller words
 * what the calls before a failure erased.
 */
export async function loeschungLaufen(lauf: (nach: string | null) => Promise<FLLoeschungLaufResponse>): Promise<LoeschungLauf> {
  let summe: LoeschungSumme = {
    abgeschlossene_saison_id: null,
    spieler: 0,
    saison_spieler: 0,
    registrierungen: 0,
    uebersprungen: 0,
    fehlgeschlagen: 0,
    verbleibend: 0,
  };

  try {
    let nach: string | null = null;
    do {
      const antwort = await lauf(nach);
      summe = {
        abgeschlossene_saison_id: antwort.abgeschlossene_saison_id,
        spieler: summe.spieler + antwort.spieler,
        saison_spieler: summe.saison_spieler + antwort.saison_spieler,
        registrierungen: summe.registrierungen + antwort.registrierungen,
        uebersprungen: summe.uebersprungen + antwort.uebersprungen,
        fehlgeschlagen: summe.fehlgeschlagen + antwort.fehlgeschlagen,
        verbleibend: antwort.verbleibend,
      };

      // A place not past the one sent would loop for ever, the hourly pass skipping every tick behind it; fixed-length
      // hex compares in id order (`docs/backend/spec.md :: I717`).
      if (nach !== null && antwort.nach !== null && antwort.nach <= nach) {
        throw new ContractBreakError("The deletion answered a place not past the one it was sent.");
      }

      // The pass's one end: `verbleibend` counts a failing person, who stays due, and a call erasing nobody may stand
      // in front of a due person the next call reaches.
      nach = antwort.nach;
    } while (nach !== null);
  } catch (fehler) {
    const { verbleibend: _unbekannt, ...bisher } = summe;
    return { ...bisher, abgebrochen: true, fehler: fehler };
  }

  return { ...summe, abgebrochen: false };
}
