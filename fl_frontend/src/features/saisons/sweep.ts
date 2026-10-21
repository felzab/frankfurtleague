import "server-only";

import { requestOf } from "@/core/errors";
import { logger } from "@/core/logging";
import { revalidateOverLoopback } from "@/core/revalidation";
import { HOUR_MS } from "@/core/timeUnits";

import { loeschungLaufen } from "./loeschung";
import { postLoeschungLauf } from "./mutations";

/**
 * One hour, as the other sweeps': a due pupil stays only until the next pass, and the rule selects on season statuses,
 * so a shorter interval only asks the backend more often.
 */
const SWEEP_INTERVAL_MS = HOUR_MS;

/**
 * A minute after start rather than at once: a deploy recreates this container before the backend
 * answers, so an immediate pass would log a failure for nothing. The first tick alone would skip a
 * container recreated daily.
 */
const SWEEP_START_DELAY_MS = 60 * 1000;

/**
 * Arms the pupils' deletion for the life of this process.
 *
 * Production runs one frontend container, so one process holds one timer and no cross-process lease
 * is built (`docs/ops/spec.md :: I149`).
 */
export function armLoeschungSweep(): void {
  const erster = setTimeout(() => void runLoeschungSweep(), SWEEP_START_DELAY_MS);
  const handle = setInterval(() => void runLoeschungSweep(), SWEEP_INTERVAL_MS);

  // Unreferenced, so neither a pending first pass nor a tick holds a shutdown open behind it: the
  // listening socket is what keeps this process alive.
  erster.unref();
  handle.unref();
}

/** Whether a pass is still running. Module state, which is per process, and one process holds the timer. */
let laeuft = false;

/**
 * One pass over the pupils the season-after rule makes due, then the squad cache's drop.
 *
 * Settles rather than throws: nothing awaits this, so a rejection would surface as an unhandled one
 * an hour after the tick that caused it.
 */
export async function runLoeschungSweep(): Promise<void> {
  if (laeuft) {
    // Each pupil is judged again in their own transaction, so a pass beside this one deletes nobody twice: skipped,
    // it asks the backend nothing for a share the running pass reaches anyway.
    logger.info("loeschung.sweep_skipped");
    return;
  }

  laeuft = true;
  try {
    await sweepLoeschung();
  } finally {
    laeuft = false;
  }
}

/** The rest the activation press left, without a deadline of its own: a timer has no request a long run would hold back. */
async function sweepLoeschung(): Promise<void> {
  const lauf = await loeschungLaufen(postLoeschungLauf);
  // On every pass, one deleting nobody included: a press's call its deadline cut may delete in the backend after the
  // press dropped this tag, and no pass's count shows those pupils (`docs/frontend/spec.md :: I705`).
  await revalidateOverLoopback(["spieler"]);

  // Counts and the season the rule kept, never a person: the backend's own lines name a failed person's id.
  // A finished pass's remainder is the pupils it failed or passed over; one cut short knows only its failures.
  if (!lauf.abgebrochen) {
    const { abgebrochen: _durchgelaufen, ...zahlen } = lauf;
    logPass(zahlen, zahlen.verbleibend);
    return;
  }

  const { abgebrochen: _abgebrochen, fehler, ...bisher } = lauf;
  logPass(bisher, bisher.fehlgeschlagen);
  // The error's name and the call's facts, never a person: this line is written for a pass that deleted nobody.
  logger.error("loeschung.sweep_failed", undefined, {
    error_code: "FE-SWEEP-001",
    name: fehler instanceof Error ? fehler.name : undefined,
    ...requestOf(fehler),
  });
}

/**
 * A warning where pupils the pass failed or passed over stay due: each pass moves on past them, so only this count tells
 * a pass failing on every pupil from a healthy one.
 */
function logPass(felder: Record<string, unknown>, offen: number): void {
  if (offen === 0) logger.info("loeschung.sweep_pass", felder);
  else logger.warn("loeschung.sweep_pass", { error_code: "FE-SWEEP-001", ...felder });
}
