import "server-only";

import { logger } from "@/core/logging";

import { loeschungLaufen } from "./loeschung";
import { postLoeschungLauf } from "./mutations";

/**
 * One pass over the pupils the season-after rule makes due, for the scheduler
 * (`fl_frontend/src/instrumentation-node.ts :: armScheduler`), which runs one pass at a time. The squad pages stop
 * naming them within the `minutes` lifetime their cached read keeps.
 *
 * Without a deadline of its own: a timer has no request a long run would hold back. Rejects where a call failed, after
 * the line counting what the calls before it erased; resolves to the pupils the pass left due.
 */
export async function runLoeschungSweep(): Promise<number> {
  const lauf = await loeschungLaufen(postLoeschungLauf);

  // Counts and the season the rule kept, never a person: the backend's own lines name a failed person's id.
  // A finished pass's remainder is the pupils it failed or passed over; one cut short knows only its failures.
  if (!lauf.abgebrochen) {
    const { abgebrochen: _durchgelaufen, ...zahlen } = lauf;
    logPass(zahlen, zahlen.verbleibend);
    return zahlen.verbleibend;
  }

  const { abgebrochen: _abgebrochen, fehler, ...bisher } = lauf;
  logPass(bisher, bisher.fehlgeschlagen);
  // The scheduler files the failure under the job's name, the error's name and the call's facts, never a person.
  throw fehler;
}

/**
 * A warning where pupils the pass failed or passed over stay due: each pass moves on past them, so only this count tells
 * a pass failing on every pupil from a healthy one.
 */
function logPass(felder: Record<string, unknown>, offen: number): void {
  if (offen === 0) logger.info("loeschung.sweep_pass", felder);
  else logger.warn("loeschung.sweep_pass", felder);
}
