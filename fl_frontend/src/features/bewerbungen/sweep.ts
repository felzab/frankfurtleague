import "server-only";

import { buildBewerbungErinnerungEmail, buildBewerbungGeloeschtEmail } from "@/core/bewerbungEmail";
import { frontend_config } from "@/core/config";
import { requestOf } from "@/core/errors";
import { kontaktBestaetigungsLink } from "@/core/kontaktLink";
import { logger } from "@/core/logging";
import { sweepAdresswechsel } from "@/features/adresswechsel/sweep";
import { postRegistrierungSweep } from "@/features/registrierungen/mutations";
import { getGermanTodayStr } from "@/shared/utils/date";
import { formatSpielDatum } from "@/shared/utils/format";

import { getBewerbungSweepSaisons, postBewerbungSweep, postBewerbungSweepAngekuendigt, postBewerbungSweepLoeschen } from "./mutations";
import { rollenText, rolleText, sendBewerbungLinkMail, sendBewerbungMail } from "./notifications";

import type { BewerbungSeat } from "@/core/bewerbungEmail";
import type { FLBewerbungSweepErinnerung, FLBewerbungSweepLoeschung } from "@/core/generated/client/types";
import type { BewerbungEmpfaenger, BewerbungLinkEmpfaenger } from "./notifications";

/** The action the mail fan-out logs a refused address under. */
const SWEEP_OPERATION = "bewerbungSweep";

/** Which half of the pass a failure line is about. Each clock family stops for its own reasons. */
type SweepFailure = "bewerbung.sweep_failed" | "registrierung.sweep_failed" | "adresswechsel.sweep_failed";

/** The rows each season half's calls passed over in one pass, summed over the seasons that answered. */
type Uebergangen = { bewerbung: number; registrierung: number };

/** What a message calls a seat whose person is gone — declined or erased, and outstanding either way. */
const SEAT_OHNE_NAMEN = "Ohne Namen";

/**
 * One pass over every season, then the clock no season holds (`docs/datenschutz.md :: 6`), for the scheduler
 * (`fl_frontend/src/instrumentation-node.ts :: armScheduler`), which runs one pass at a time.
 */
export async function runBewerbungSweep(): Promise<void> {
  await sweepAlleSaisons();
  // Catching its own throw, as a season's two halves do: a shared `try` would leave a lapsed address standing every
  // hour the seasons' loop fails.
  await sweepAdresswechsel();
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

/** The registration's clocks, one season at a time: the erasures are done and the reminders owed before this answers. */
async function sweepRegistrierungen(saisonId: string, uebergangen: Uebergangen): Promise<void> {
  uebergangen.registrierung += (await postRegistrierungSweep(saisonId)).fehlgeschlagen;
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
