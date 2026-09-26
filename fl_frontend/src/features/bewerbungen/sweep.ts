import "server-only";

import { buildBewerbungErinnerungEmail, buildBewerbungGeloeschtEmail } from "@/core/bewerbungEmail";
import { frontend_config } from "@/core/config";
import { logger } from "@/core/logging";
import { buildRegistrierungErinnerungEmail, buildRegistrierungSaisonendeEmail } from "@/core/registrierungEmail";
import { REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE } from "@/features/registrierungen/constants";
import { postRegistrierungSweep } from "@/features/registrierungen/mutations";
import { sendZielMail } from "@/features/zustellung/notifications";
import { getGermanTodayStr } from "@/shared/utils/date";
import { formatSpielDatum } from "@/shared/utils/format";

import { bestaetigungsLink } from "./bestaetigungLink";
import { getBewerbungSweepSaisons, postBewerbungSweep, postBewerbungSweepAngekuendigt, postBewerbungSweepLoeschen } from "./mutations";
import { rollenText, rolleText, sendBewerbungLinkMail, sendBewerbungMail } from "./notifications";

import type { BewerbungSeat } from "@/core/bewerbungEmail";
import type { FLRegistrierungSweepBenachrichtigung, FLRegistrierungSweepErinnerung } from "@/features/registrierungen/schemas";
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

/** Which half of a season's pass a failure line is about. The two clock families stop for their own reasons. */
type SweepFailure = "bewerbung.sweep_failed" | "registrierung.sweep_failed";

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
    logSweepFailure("bewerbung.sweep_failed", error, undefined);
    return;
  }

  // Season by season and never in parallel: the sweep is on the clock of a day, and one slow pass
  // costs nothing, where a fan-out would put every season's mail on the transport at once.
  for (const saisonId of saisonIds) {
    try {
      await sweepSaison(saisonId);
    } catch (error) {
      logSweepFailure("bewerbung.sweep_failed", error, saisonId);
    }
  }
}

/**
 * One season, as TWO independent halves: a throw in either leaves the other's clocks running.
 *
 * A shared `try` holds the registrations past their deadline every hour the application half fails
 * (`docs/backend/spec.md :: I294`).
 */
async function sweepSaison(saisonId: string): Promise<void> {
  try {
    await sweepBewerbungen(saisonId);
  } catch (error) {
    logSweepFailure("bewerbung.sweep_failed", error, saisonId);
  }

  // Its own event beside the application's: one line for both halves cannot say which stopped, and
  // that is the question `docs/ops/runbooks.md` section 9 sends an operator to the logs with.
  try {
    await sweepRegistrierungen(saisonId);
  } catch (error) {
    logSweepFailure("registrierung.sweep_failed", error, saisonId);
  }
}

/** The application's own clocks: the endpoint takes one season because a retention removal's filter names one (`docs/backend/spec.md :: I150`). */
async function sweepBewerbungen(saisonId: string): Promise<void> {
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
  if (angekuendigt.length > 0) await postBewerbungSweepLoeschen(saisonId, { bewerbung_ids: angekuendigt });
}

/** The registration's clocks, one season at a time: the erasures are done before this answers, and what comes back is what to mail. */
async function sweepRegistrierungen(saisonId: string): Promise<void> {
  const { erinnerungen, benachrichtigt } = await postRegistrierungSweep(saisonId);

  // Stamped by the call above and mailed here, as the application's reminder is: a failed send costs
  // one pupil one reminder, where mailing first would re-send every hour until the address worked.
  for (const erinnerung of erinnerungen) {
    await mailRegistrierungErinnerung(erinnerung);
  }

  // AFTER the erasure, which the call above already made: a notice cannot prolong a row nobody
  // decided, so this message reports rather than asks, and a failed one costs one pupil one notice.
  for (const notiz of benachrichtigt) {
    await mailRegistrierungNotiz(notiz);
  }
}

/** One reminder to one pupil, carrying the fresh link the pass minted; the first link stays valid beside it. */
async function mailRegistrierungErinnerung(erinnerung: FLRegistrierungSweepErinnerung): Promise<void> {
  // The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is not
  // production must not mail production links (`docs/frontend/spec.md :: I186`).
  const origin = frontend_config.AUTH_URL;

  await sendZielMail({
    operation: SWEEP_OPERATION,
    // No idempotency key: every reminder mints a fresh token, so one key over two bodies would be
    // refused rather than collapsed (`fl_frontend/src/features/zustellung/notifications.ts :: zielIdempotenzSchluessel`).
    auftrag: { ziel: "registrierung", zielId: erinnerung.registrierung_id, anlass: "erinnerung" },
    recipients: [erinnerung.email],
    buildMail: () =>
      buildRegistrierungErinnerungEmail({
        vorname: erinnerung.vorname,
        teamName: erinnerung.team,
        saisonId: erinnerung.saison_id,
        origin: origin,
        token: erinnerung.token,
        // The WINDOW the first message named, not a fresh one: the message says the deadline has not
        // moved, and the mirrored bound is what both messages count it in.
        fristTage: REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE,
      }),
  });
}

/** The one note a pupil gets about their erased registration. Its row is gone, so nothing records what this send cost. */
async function mailRegistrierungNotiz(notiz: FLRegistrierungSweepBenachrichtigung): Promise<void> {
  await sendZielMail({
    operation: SWEEP_OPERATION,
    // The day as the key's tag: this body carries no link and cannot change inside the provider's
    // window, so a pass that mailed and then failed composes the identical message an hour later.
    auftrag: { ziel: "registrierung", zielId: notiz.registrierung_id, anlass: "loeschung", idempotenzTag: getGermanTodayStr() },
    recipients: [notiz.email],
    buildMail: () =>
      buildRegistrierungSaisonendeEmail({
        vorname: notiz.vorname,
        teamName: notiz.team,
        saisonId: notiz.saison_id,
        origin: frontend_config.AUTH_URL,
      }),
  });
}

/** One message to one mailbox, carrying one link per PERSON it holds -- a mirrored pair is one link naming both seats. */
async function mailErinnerung(erinnerung: FLBewerbungSweepErinnerung): Promise<void> {
  // The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is not
  // production must not mail production links (`docs/frontend/spec.md :: I186`).
  const origin = frontend_config.AUTH_URL;
  const [erster, ...weitere] = erinnerung.seats.map((seat) => ({
    vorname: seat.vorname,
    rolleText: rollenText(seat.rollen),
    link: bestaetigungsLink(origin, seat.token),
  }));

  // The wire can carry an empty list where the recipient type cannot, and a message offering no link
  // is one nobody can answer.
  if (erster === undefined) return;

  const empfaenger: BewerbungLinkEmpfaenger = {
    address: erinnerung.email,
    rollen: erinnerung.seats.flatMap((seat) => seat.rollen),
    seats: [erster, ...weitere],
  };

  await sendBewerbungLinkMail({
    operation: SWEEP_OPERATION,
    // No idempotency key: every reminder mints a fresh token, so one key over two bodies would be
    // refused rather than collapsed (`fl_frontend/src/features/bewerbungen/notifications.ts :: zustellungIdempotenzSchluessel`).
    auftrag: { bewerbungId: erinnerung.bewerbung_id, anlass: "erinnerung" },
    recipients: [empfaenger],
    buildMail: (seats) =>
      buildBewerbungErinnerungEmail({
        saisonId: erinnerung.saison_id,
        origin: origin,
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
    rollen: loeschung.ansprechperson_rollen,
    rollenText: rollenText(loeschung.ansprechperson_rollen),
  };

  const { delivered } = await sendBewerbungMail({
    operation: SWEEP_OPERATION,
    // The one send here that may legitimately repeat: a pass that mailed and then failed to stamp
    // composes the identical notice an hour later. This body carries no token, which is what makes
    // a key safe at all.
    auftrag: { bewerbungId: loeschung.bewerbung_id, anlass: "loeschung", idempotenzTag: getGermanTodayStr() },
    recipients: [empfaenger],
    buildMail: (rollen) =>
      buildBewerbungGeloeschtEmail({
        saisonId: loeschung.saison_id,
        origin: frontend_config.AUTH_URL,
        rollenText: rollen,
        ausstehend: ausstehend,
      }),
  });

  return delivered.length > 0;
}

/** The half, the season and the error's name, never a person: this line is written for a season nobody swept. */
function logSweepFailure(event: SweepFailure, error: unknown, saisonId: string | undefined): void {
  logger.error(event, undefined, {
    error_code: "FE-SWEEP-001",
    name: error instanceof Error ? error.name : undefined,
    saison_id: saisonId,
  });
}
