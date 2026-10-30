import "server-only";

import { buildBewerbungErinnerungEmail, buildBewerbungGeloeschtEmail } from "@/core/bewerbungEmail";
import { frontend_config } from "@/core/config";
import { ContractBreakError, requestOf } from "@/core/errors";
import { kontaktBestaetigungsLink } from "@/core/kontaktLink";
import { logger } from "@/core/logging";
import { buildRegistrierungErinnerungEmail } from "@/core/registrierungEmail";
import { HOUR_MS } from "@/core/timeUnits";
import { postAdresswechselSweep } from "@/features/adresswechsel/mutations";
import { runAdresswechselPostausgang } from "@/features/adresswechsel/postausgang";
import { REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE } from "@/features/registrierungen/constants";
import { postRegistrierungSweep } from "@/features/registrierungen/mutations";
import { sendZielMail } from "@/features/zustellung/notifications";
import { getGermanTodayStr } from "@/shared/utils/date";
import { formatSpielDatum } from "@/shared/utils/format";

import { getBewerbungSweepSaisons, postBewerbungSweep, postBewerbungSweepAngekuendigt, postBewerbungSweepLoeschen } from "./mutations";
import { rollenText, rolleText, sendBewerbungLinkMail, sendBewerbungMail } from "./notifications";

import type { BewerbungSeat } from "@/core/bewerbungEmail";
import type { FLAdresswechselSweepResponse } from "@/core/generated/client/types";
import type { FLRegistrierungSweepErinnerung } from "@/features/registrierungen/schemas";
import type { BewerbungEmpfaenger, BewerbungLinkEmpfaenger } from "./notifications";
import type { FLBewerbungSweepErinnerung, FLBewerbungSweepLoeschung } from "./schemas";

/**
 * One hour. Every clock selects on a date, so the interval decides only how late in the day a
 * deadline is acted on, and a shorter one buys a punctuality nobody has asked for.
 */
const SWEEP_INTERVAL_MS = HOUR_MS;

/**
 * A minute after start rather than at once: a deploy recreates this container before the backend
 * answers, so an immediate pass would log a failure for nothing. The first tick alone would skip a
 * container recreated daily.
 */
const SWEEP_START_DELAY_MS = 60 * 1000;

/** The action the mail fan-out logs a refused address under. */
const SWEEP_OPERATION = "bewerbungSweep";

/** Which half of the pass a failure line is about. Each clock family stops for its own reasons. */
type SweepFailure = "bewerbung.sweep_failed" | "registrierung.sweep_failed" | "adresswechsel.sweep_failed";

/** The rows each season half's calls passed over in one pass, summed over the seasons that answered. */
type Uebergangen = { bewerbung: number; registrierung: number };

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
 * One pass over every season, then the clock no season holds (`docs/datenschutz.md :: 6`).
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
    // Catching its own throw, as a season's two halves do: a shared `try` would leave a lapsed address standing every
    // hour the seasons' loop fails.
    await sweepAdresswechsel();
  } finally {
    laeuft = false;
  }
}

/**
 * Every pending change whose step lapsed, and every one whose waiting time ended. On every pass: no switch holds a
 * lapsed address or keeps a due one from taking effect.
 */
async function sweepAdresswechsel(): Promise<void> {
  let entfernt = 0;
  let wirksam = 0;
  let verworfen = 0;
  try {
    let antwort: FLAdresswechselSweepResponse;
    let nach: string | null = null;
    do {
      antwort = await postAdresswechselSweep(nach);
      entfernt += antwort.entfernt;
      verworfen += antwort.verworfen;
      wirksam += antwort.wirksam;
      // The pass's one end and its guard against a place not past the one sent, as the pupils' deletion's
      // (`fl_frontend/src/features/saisons/loeschung.ts :: loeschungLaufen`).
      if (nach !== null && antwort.nach !== null && antwort.nach <= nach) {
        throw new ContractBreakError("The lapsed addresses answered a place not past the one they were sent.");
      }
      nach = antwort.nach;
    } while (nach !== null);

    // The last call's count, never a sum: each call counts every lapsed change standing, an earlier page's failures among them.
    logPass(
      "adresswechsel.sweep_pass",
      { entfernt: entfernt, wirksam: wirksam, verworfen: verworfen, verbleibend: antwort.verbleibend },
      antwort.verbleibend,
    );
  } catch (error) {
    logger.info("adresswechsel.sweep_pass", { entfernt: entfernt, wirksam: wirksam, verworfen: verworfen });
    logSweepFailure("adresswechsel.sweep_failed", error, undefined);
  }

  // Whatever the calls came to: every notice an end queued, this pass's and any whose answer a confirmation or an
  // approval lost, is delivered from the outbox.
  await runAdresswechselPostausgang();
}

async function sweepAlleSaisons(): Promise<void> {
  let saisonIds: readonly string[];

  try {
    ({ saison_ids: saisonIds } = await getBewerbungSweepSaisons());
  } catch (error) {
    logSweepFailure("bewerbung.sweep_failed", error, undefined);
    return;
  }

  const uebergangen: Uebergangen = { bewerbung: 0, registrierung: 0 };
  // Season by season and never in parallel: the sweep is on the clock of a day, and one slow pass
  // costs nothing, where a fan-out would put every season's mail on the transport at once.
  for (const saisonId of saisonIds) {
    try {
      await sweepSaison(saisonId, uebergangen);
    } catch (error) {
      logSweepFailure("bewerbung.sweep_failed", error, saisonId);
    }
  }

  logPass("bewerbung.sweep_pass", { fehlgeschlagen: uebergangen.bewerbung }, uebergangen.bewerbung);
  logPass("registrierung.sweep_pass", { fehlgeschlagen: uebergangen.registrierung }, uebergangen.registrierung);
}

/**
 * A warning where `offen` rows the half failed or passed over stand: each pass moves on past them, so only this count
 * tells a half failing on every row from a healthy one.
 */
function logPass(
  event: "bewerbung.sweep_pass" | "registrierung.sweep_pass" | "adresswechsel.sweep_pass",
  felder: Record<string, unknown>,
  offen: number,
): void {
  if (offen === 0) logger.info(event, felder);
  else logger.warn(event, felder);
}

/**
 * One season, as TWO independent halves: a throw in either leaves the other's clocks running.
 *
 * A shared `try` holds the registrations past their deadline every hour the application half fails.
 */
async function sweepSaison(saisonId: string, uebergangen: Uebergangen): Promise<void> {
  try {
    await sweepBewerbungen(saisonId, uebergangen);
  } catch (error) {
    logSweepFailure("bewerbung.sweep_failed", error, saisonId);
  }

  // Its own event beside the application's: one line for both halves cannot say which stopped, and
  // that is the question `docs/ops/runbooks.md` section 9 sends an operator to the logs with.
  try {
    await sweepRegistrierungen(saisonId, uebergangen);
  } catch (error) {
    logSweepFailure("registrierung.sweep_failed", error, saisonId);
  }
}

/** The application's own clocks: the endpoint takes one season because a retention removal's filter names one. */
async function sweepBewerbungen(saisonId: string, uebergangen: Uebergangen): Promise<void> {
  const { erinnerungen, loeschungen, fehlgeschlagen } = await postBewerbungSweep(saisonId);
  // Added as each call answers, so a later call that throws keeps the earlier counts.
  uebergangen.bewerbung += fehlgeschlagen;

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
  if (zugestellt.length > 0) {
    uebergangen.bewerbung += (await postBewerbungSweepAngekuendigt(saisonId, { bewerbung_ids: zugestellt })).fehlgeschlagen;
  }

  // Everything announced: the ids just stamped, and those a previous pass announced and then failed
  // to erase. The endpoint re-judges each, so one that has stopped qualifying is skipped.
  const angekuendigt = [...loeschungen.filter((kandidat) => kandidat.angekuendigt).map((kandidat) => kandidat.bewerbung_id), ...zugestellt];
  if (angekuendigt.length > 0) {
    uebergangen.bewerbung += (await postBewerbungSweepLoeschen(saisonId, { bewerbung_ids: angekuendigt })).fehlgeschlagen;
  }
}

/** The registration's clocks, one season at a time: the erasures are done before this answers, and what comes back is what to mail. */
async function sweepRegistrierungen(saisonId: string, uebergangen: Uebergangen): Promise<void> {
  const { erinnerungen, fehlgeschlagen } = await postRegistrierungSweep(saisonId);
  uebergangen.registrierung += fehlgeschlagen;

  // Stamped by the call above and mailed here, as the application's reminder is: a failed send costs
  // one pupil one reminder, where mailing first would re-send every hour until the address worked.
  for (const erinnerung of erinnerungen) {
    await mailRegistrierungErinnerung(erinnerung);
  }
}

/** One reminder to one pupil, carrying the fresh link the pass minted; the first link stays valid beside it. */
async function mailRegistrierungErinnerung(erinnerung: FLRegistrierungSweepErinnerung): Promise<void> {
  // The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is not
  // production must not mail production links.
  const origin = frontend_config.AUTH_URL;

  await sendZielMail({
    operation: SWEEP_OPERATION,
    // No idempotency key: every reminder mints a fresh token, so one key over two bodies would be
    // refused rather than collapsed (`fl_frontend/src/features/zustellung/notifications.ts :: zielIdempotenzSchluessel`).
    auftrag: { ziel: "registrierung", zielId: erinnerung.registrierung_id, anlass: "erinnerung" },
    recipients: [erinnerung.email],
    buildMail: () =>
      buildRegistrierungErinnerungEmail({
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

/** One message to one mailbox, carrying one link per PERSON it holds -- a mirrored pair is one link naming both seats. */
async function mailErinnerung(erinnerung: FLBewerbungSweepErinnerung): Promise<void> {
  // The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is not
  // production must not mail production links.
  const origin = frontend_config.AUTH_URL;
  const [erster, ...weitere] = erinnerung.seats.map((seat) => ({
    vorname: seat.vorname,
    rolleText: rollenText(seat.rollen),
    link: kontaktBestaetigungsLink(origin, seat.token),
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
        // The deadline the first message gave; a reminder does not move it.
        fristText: formatSpielDatum(erinnerung.bestaetigungsfrist),
      }),
  });
}

/** Whether this application may now be erased: the notice reached somebody, was filed off production or kept from a barred address, or had nobody to reach. */
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

  const { delivered, withheld, gesperrt } = await sendBewerbungMail({
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

  return (
    delivered.length > 0 ||
    // A barred mailbox is as told as the league may make it, anywhere: waiting on it would keep the
    // application for as long as the ban stands.
    gesperrt > 0 ||
    // Off production a filed notice is as told as anyone there is; waiting on a send that never comes
    // would re-file it hourly. Production waits for a real send: withheld there means a missing key.
    (withheld.length > 0 && frontend_config.APP_ENV !== "production")
  );
}

/** The half, the season and the error's name, never a person: this line is written for a season nobody swept. */
function logSweepFailure(event: SweepFailure, error: unknown, saisonId: string | undefined): void {
  logger.error(event, undefined, {
    name: error instanceof Error ? error.name : undefined,
    ...requestOf(error),
    saison_id: saisonId,
  });
}
