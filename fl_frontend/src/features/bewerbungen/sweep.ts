import "server-only";

import { buildBewerbungErinnerungEmail, buildBewerbungGeloeschtEmail } from "@/core/bewerbungEmail";
import { SITE_URL } from "@/core/brand";
import { logger } from "@/core/logging";
import { formatSpielDatum } from "@/shared/utils/format";

import { BEWERBUNG_SEATS } from "./constants";
import { getBewerbungSweepSaisons, postBewerbungSweep, postBewerbungSweepLoeschen } from "./mutations";
import { sendBewerbungLinkMail, sendBewerbungMail } from "./notifications";

import type { BewerbungSeat } from "@/core/bewerbungEmail";
import type { BewerbungEmpfaenger, BewerbungLinkEmpfaenger } from "./notifications";
import type { FLBewerbungSweepErinnerung, FLBewerbungSweepLoeschung, FLKontaktRolle } from "./schemas";

/**
 * One hour (ruling 64). Every clock selects on a date, so the interval decides only how late in the
 * day a deadline is acted on, and a shorter one buys a punctuality nobody has asked for.
 */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Ruling S1-ai. The argument is at the line that uses it. */
const SWEEP_START_DELAY_MS = 60 * 1000;

/** The action the mail fan-out logs a refused address under. */
const SWEEP_OPERATION = "bewerbungSweep";

/** What a message calls a seat whose person is gone — declined or erased, and outstanding either way. */
const SEAT_OHNE_NAMEN = "Ohne Namen";

/** The one place a confirmation link is spelled, as `fl_frontend/src/app/api/bewerbung/route.ts` spells it. */
const bestaetigungsLink = (token: string): string => `${SITE_URL}/bestaetigung?token=${token}`;

/** How a seat is named to somebody who is not sitting in it, in the wording the form asked for it under. */
const rolleText = (rolle: FLKontaktRolle): string => BEWERBUNG_SEATS.find((seat) => seat.value === rolle)?.label ?? "";

/**
 * Arms the retention sweep for the life of this process.
 *
 * Production runs one frontend container, so one process holds one timer and no cross-process lease
 * is built; a second `frontend` service or a replica count would end that.
 */
export function armBewerbungSweep(): void {
  // A minute after start rather than at once (ruling S1-ai): a deploy recreates this container
  // before the backend answers, so an immediate pass logs a failure for nothing. The first tick
  // alone would skip a container recreated daily.
  const erster = setTimeout(() => void runBewerbungSweep(), SWEEP_START_DELAY_MS);
  const handle = setInterval(() => void runBewerbungSweep(), SWEEP_INTERVAL_MS);

  // Unreferenced, so neither a pending first pass nor a tick holds a shutdown open behind it: the
  // listening socket is what keeps this process alive.
  erster.unref();
  handle.unref();
}

/**
 * One pass over every season, which is what the clocks are (`docs/datenschutz.md` §6).
 *
 * Settles rather than throws: nothing awaits this, so a rejection would surface as an unhandled one
 * an hour after the tick that caused it.
 */
export async function runBewerbungSweep(): Promise<void> {
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

/** One season: the endpoint takes one because an erasure's filter names one (`docs/backend/spec.md :: I48`). */
async function sweepSaison(saisonId: string): Promise<void> {
  const { erinnerungen, loeschungen } = await postBewerbungSweep(saisonId);

  // Stamped by the call above and mailed here: a failed send costs one person one reminder, where
  // mailing first would re-send every day until the address worked.
  for (const erinnerung of erinnerungen) {
    await mailErinnerung(erinnerung);
  }

  const geloescht: string[] = [];
  for (const loeschung of loeschungen) {
    // Mailed BEFORE the erasure and erased only where it arrived: an application standing a day past
    // its deadline harms nobody, and a person never told is the failure the ruling is about.
    if (await mailLoeschung(loeschung)) geloescht.push(loeschung.bewerbung_id);
  }

  if (geloescht.length === 0) return;

  await postBewerbungSweepLoeschen(saisonId, { bewerbung_ids: geloescht });
}

/** One message to one mailbox, carrying one link per seat of this application that mailbox holds. */
async function mailErinnerung(erinnerung: FLBewerbungSweepErinnerung): Promise<void> {
  const [erster, ...weitere] = erinnerung.seats.map((seat) => ({
    vorname: seat.vorname,
    rolleText: rolleText(seat.rolle),
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
        // The deadline the first message gave, which the reminder does not move (ruling 61).
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

  // The submitter is the Ansprechperson by convention (ruling 65), so that is the seat this message
  // names its reader by.
  const empfaenger: BewerbungEmpfaenger = { address: loeschung.ansprechperson_email, rollenText: rolleText("ansprechperson") };

  const { delivered } = await sendBewerbungMail({
    operation: SWEEP_OPERATION,
    recipients: [empfaenger],
    buildMail: (rollenText) => buildBewerbungGeloeschtEmail({ saisonId: loeschung.saison_id, rollenText: rollenText, ausstehend: ausstehend }),
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
