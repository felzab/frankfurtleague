import "server-only";

import { sweepLoeschung } from "./loeschung";
import { postLoeschungSweep } from "./mutations";

/**
 * One pass over the pupils the season-after rule makes due, for the scheduler
 * (`fl_frontend/src/instrumentation-node.ts :: armScheduler`), which runs one pass at a time. The squad pages stop
 * naming them within the `minutes` lifetime their cached read keeps.
 *
 * Without a deadline of its own: a timer has no request a long run would hold back. Answers the counts and the season
 * the rule kept, never a person, the backend's own lines naming a failed person's id: `offen` the pupils a finished pass
 * failed or passed over, and a pass a call cut short its failures, with that call's `fehler`.
 */
export async function runLoeschungSweep() {
  const lauf = await sweepLoeschung(postLoeschungSweep);

  if (!lauf.abgebrochen) {
    const { abgebrochen: _durchgelaufen, ...zahlen } = lauf;
    return { count: zahlen, offen: zahlen.verbleibend };
  }

  const { abgebrochen: _abgebrochen, fehler, ...bisher } = lauf;
  return { count: bisher, offen: bisher.fehlgeschlagen, error: fehler };
}
