import "server-only";

import { buildBewerbungErinnerungEmail, buildBewerbungGeloeschtEmail } from "@/core/bewerbungEmail";
import { logger } from "@/core/logging";
import { formatSpielDatum } from "@/shared/utils/format";

import { bestaetigungsLink } from "./bestaetigungLink";
import { getBewerbungSweepSaisons, postBewerbungSweep, postBewerbungSweepAngekuendigt, postBewerbungSweepLoeschen } from "./mutations";
import { rollenText, rolleText, sendBewerbungLinkMail, sendBewerbungMail } from "./notifications";

import type { BewerbungSeat } from "@/core/bewerbungEmail";
import type { BewerbungEmpfaenger, BewerbungLinkEmpfaenger } from "./notifications";
import type { FLBewerbungSweepErinnerung, FLBewerbungSweepLoeschung } from "./schemas";

/**
 * One hour. Every clock selects on a date, so the interval decides only how late in the day a
 * deadline is acted on, and a shorter one buys a punctuality nobody has asked for.
 */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * A minute after start rather than at once: a deploy recreates this container before the backend
 * answers, so an immediate pass would log a failure for nothing. The first tick alone would skip a
 * container recreated daily.
 */
const SWEEP_START_DELAY_MS = 60 * 1000;

/** The action the mail fan-out logs a refused address under. */
const SWEEP_OPERATION = "bewerbungSweep";

/** What a message calls a seat whose person is gone — declined or erased, and outstanding either way. */
const SEAT_OHNE_NAMEN = "Ohne Namen";

/**
 * Arms the retention sweep for the life of this process.
 *
 * Production runs one frontend container, so one process holds one timer and no cross-process lease
 * is built; a second `frontend` service or a replica count would end that.
 */
export function armBewerbungSweep(): void {
  const erster = setTimeout(() => void runBewerbungSweep(), SWEEP_START_DELAY_MS);
  const handle = setInterval(() => void runBewerbungSweep(), SWEEP_INTERVAL_MS);

  // Unreferenced, so neither a pending first pass nor a tick holds a shutdown open behind it: the
  // listening socket is what keeps this process alive.
  erster.unref();
  handle.unref();
}

/** Whether a pass is still running. Module state, which is per process, and one process holds the timer. */
let laeuft = false;

/**
 * One pass over every season, which is what the clocks are (`docs/datenschutz.md :: 6`).
 *
 * Settles rather than throws: nothing awaits this, so a rejection would surface as an unhandled one
 * an hour after the tick that caused it.
 */
export async function runBewerbungSweep(): Promise<void> {
  if (laeuft) {
    // A pass slower than the hour would otherwise run beside itself over the same rows, mailing one
    // person twice before either half reached its stamp. No application and no address is named.
    logger.info("bewerbung.sweep_skipped");
    return;
  }

  laeuft = true;
  try {
    await sweepAlleSaisons();
  } finally {
    laeuft = false;
  }
}

async function sweepAlleSaisons(): Promise<void> {
  let saisonIds: readonly string[];

  try {
    ({ saison_ids: saisonIds } = await getBewerbungSweepSaisons());
  } catch (error) {
    logSweepFailure(error, undefined);
    return;
  }

  // Season by season and never in parallel: the sweep is on the clock of a day, and one slow pass
  // costs nothing, where a fan-out would put every season's mail on the transport at once.
  for (const saisonId of saisonIds) {
    try {
      await sweepSaison(saisonId);
    } catch (error) {
      logSweepFailure(error, saisonId);
    }
  }
}

/** One season: the endpoint takes one because a retention removal's filter names one (`docs/backend/spec.md :: I150`). */
async function sweepSaison(saisonId: string): Promise<void> {
  const { erinnerungen, loeschungen } = await postBewerbungSweep(saisonId);

  // Stamped by the call above and mailed here: a failed send costs one person one reminder, where
  // mailing first would re-send every day until the address worked.
  for (const erinnerung of erinnerungen) {
    await mailErinnerung(erinnerung);
  }

  // Mailed BEFORE the erasure and only to whoever has not been told: an application standing a day
  // past its deadline harms nobody, where a person never told is the failure the notice exists for.
  const zugestellt: string[] = [];
  for (const loeschung of loeschungen.filter((kandidat) => !kandidat.angekuendigt)) {
    if (await mailLoeschung(loeschung)) zugestellt.push(loeschung.bewerbung_id);
  }

  // Mail, then stamp: the floor is one notice repeated once, where stamping first would erase an
  // application nobody was told about. That is the worse failure, so the order is this way round.
  if (zugestellt.length > 0) await postBewerbungSweepAngekuendigt(saisonId, { bewerbung_ids: zugestellt });

  // Everything announced: the ids just stamped, and those a previous pass announced and then failed
  // to erase. The endpoint re-judges each, so one that has stopped qualifying is skipped.
  const angekuendigt = [...loeschungen.filter((kandidat) => kandidat.angekuendigt).map((kandidat) => kandidat.bewerbung_id), ...zugestellt];
  if (angekuendigt.length === 0) return;

  await postBewerbungSweepLoeschen(saisonId, { bewerbung_ids: angekuendigt });
}

/** One message to one mailbox, carrying one link per PERSON it holds -- a mirrored pair is one link naming both seats. */
async function mailErinnerung(erinnerung: FLBewerbungSweepErinnerung): Promise<void> {
  const [erster, ...weitere] = erinnerung.seats.map((seat) => ({
    vorname: seat.vorname,
    rolleText: rollenText(seat.rollen),
    link: bestaetigungsLink(seat.token),
  }));

  // The wire can carry an empty list where the recipient type cannot, and a message offering no link
  // is one nobody can answer.
  if (erster === undefined) return;

  const empfaenger: BewerbungLinkEmpfaenger = { address: erinnerung.email, seats: [erster, ...weitere] };

  await sendBewerbungLinkMail({
    operation: SWEEP_OPERATION,
    recipients: [empfaenger],
    buildMail: (seats) =>
      buildBewerbungErinnerungEmail({
        saisonId: erinnerung.saison_id,
        schule: erinnerung.schule,
        seats: seats,
        // The deadline the first message gave; a reminder does not move it (`docs/backend/spec.md :: I152`).
        fristText: formatSpielDatum(erinnerung.bestaetigungsfrist),
      }),
  });
}

/** Whether this application may now be erased: the notice reached somebody, or there was nobody to reach. */
async function mailLoeschung(loeschung: FLBewerbungSweepLoeschung): Promise<boolean> {
  // An emptied Ansprechperson slot leaves the message no reader. Erased anyway: the alternative
  // keeps an application nobody can complete and nobody can be told about, for ever.
  if (loeschung.ansprechperson_email === null) return true;

  const ausstehend: BewerbungSeat[] = loeschung.ausstehend.map((seat) => ({
    vorname: seat.vorname ?? SEAT_OHNE_NAMEN,
    rolleText: rolleText(seat.rolle),
  }));

  // Every seat this mailbox holds, not the Ansprechperson alone: a submitter who is also the Trainer
  // is named by both, and the notice then lists a seat it has already told them they hold.
  const empfaenger: BewerbungEmpfaenger = {
    address: loeschung.ansprechperson_email,
    rollenText: rollenText(loeschung.ansprechperson_rollen),
  };

  const { delivered } = await sendBewerbungMail({
    operation: SWEEP_OPERATION,
    recipients: [empfaenger],
    buildMail: (rollen) => buildBewerbungGeloeschtEmail({ saisonId: loeschung.saison_id, rollenText: rollen, ausstehend: ausstehend }),
  });

  return delivered.length > 0;
}

/** The season and the error's name, never a person: this line is written for a season nobody swept. */
function logSweepFailure(error: unknown, saisonId: string | undefined): void {
  logger.error("bewerbung.sweep_failed", undefined, {
    name: error instanceof Error ? error.name : undefined,
    error_code: "FE-SWEEP-001",
    saison_id: saisonId,
  });
}
