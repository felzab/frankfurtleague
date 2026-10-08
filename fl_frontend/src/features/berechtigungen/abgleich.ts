import "server-only";

import { buildBerechtigungEmail } from "@/core/berechtigungEmail";
import { BERECHTIGUNG_HINWEIS, BERECHTIGUNG_TAG } from "@/core/berechtigungTag";
import { frontend_config } from "@/core/config";
import { logger } from "@/core/logging";
import { MailRecipientError, sendMail } from "@/core/mail";
import { mailIdempotencyKey } from "@/core/mailIdempotencyKey";
import { versandAusfallOf } from "@/core/versandAusfall";

import { postBerechtigungenAbgleich, postBerechtigungenAngekuendigt } from "./mutations";

import type { Urheber, Zugangsaenderung } from "@/core/berechtigungEmail";
import type { FLBerechtigungAenderung } from "./schemas";

/**
 * Five minutes: this is the lane that says who may administer, and a pass is one claim over a handful of
 * rows. A change made in the application is announced at once besides (`runBerechtigungenAbgleich`).
 */
const ABGLEICH_INTERVAL_MS = 5 * 60 * 1000;

/** A minute after start, for the application sweep's reason: a deploy recreates this container before the backend answers. */
const ABGLEICH_START_DELAY_MS = 60 * 1000;

/**
 * Arms the reconciliation pass for the life of this process. Every change to the grants reaches it,
 * a change made in the database directly included, through the claim's outbox (`docs/backend/spec.md :: I439`).
 */
export function armBerechtigungenAbgleich(): void {
  const erster = setTimeout(() => void runBerechtigungenAbgleich(), ABGLEICH_START_DELAY_MS);
  const handle = setInterval(() => void runBerechtigungenAbgleich(), ABGLEICH_INTERVAL_MS);

  // Unreferenced, so neither holds a shutdown open: the listening socket keeps this process alive.
  erster.unref();
  handle.unref();
}

/**
 * Whether a pass is running, and whether a change arrived while it ran, per module instance: Next may
 * load one for the boot and one for the actions, and the claim hands a second pass none of the first's rows.
 */
let laeuft = false;
let nochmal = false;

/** Per outbox row this instance still holds unstamped, the recipients already told. */
const offen = new Map<string, Set<string>>();

/** The dead rows last warned of: a count that stands is warned once, not at every pass while nobody repairs it. */
let gewarntUebersprungen = 0;

/**
 * One pass, or a second one queued behind the pass already running: a change written after that pass
 * claimed would otherwise wait for the next tick. Settles rather than throws, nothing awaiting it.
 */
export async function runBerechtigungenAbgleich(): Promise<void> {
  if (laeuft) {
    nochmal = true;
    return;
  }

  laeuft = true;
  try {
    do {
      nochmal = false;
      await abgleichen();
    } while (nochmal);
  } finally {
    laeuft = false;
  }
}

/** Claim, mail, then stamp what was mailed: an unstamped row returns at the next claim once its lease has lapsed. */
async function abgleichen(): Promise<void> {
  let claim;
  try {
    claim = await postBerechtigungenAbgleich();
  } catch (error) {
    logAbgleichFailure("berechtigung.abgleich_failed", error);
    return;
  }

  if (claim.uebersprungen > gewarntUebersprungen) {
    logger.warn("berechtigung.abgleich_uebersprungen", { error_code: "FE-SWEEP-002", anzahl: claim.uebersprungen });
  }
  // Down as well as up, so a row repaired and another made dead later is warned of again.
  gewarntUebersprungen = claim.uebersprungen;
  // A row this claim does not hold is another instance's or stamped already: kept, it would only grow.
  const gehalten = new Set(claim.aenderungen.map((aenderung) => aenderung.id));
  for (const id of offen.keys()) if (!gehalten.has(id)) offen.delete(id);

  if (claim.beanspruchung === null || claim.aenderungen.length === 0) return;

  const angekuendigt: string[] = [];
  for (const aenderung of claim.aenderungen) {
    if (await ankuendigen(aenderung, claim.empfaenger)) angekuendigt.push(aenderung.id);
  }

  if (angekuendigt.length === 0) return;

  try {
    await postBerechtigungenAngekuendigt({ beanspruchung: claim.beanspruchung, ids: angekuendigt });
  } catch (error) {
    // Left for the next claim once this one lapses: it mails these rows again, which the key collapses.
    logAbgleichFailure("berechtigung.stempel_failed", error);
  }
}

/**
 * Mails one change to every current holder and to the address the change names, where the answer names
 * it: a barred address is withheld, and never mailed. Answers whether the row is done: all settled, or given up.
 */
async function ankuendigen(aenderung: FLBerechtigungAenderung, empfaenger: readonly string[]): Promise<boolean> {
  const genannt = [aenderung.jetzt?.adresse, aenderung.vorher?.adresse].filter((adresse) => adresse !== null && adresse !== undefined);
  const adressen = [...new Set([...empfaenger, ...genannt])];
  const erreicht = offen.get(aenderung.id) ?? new Set<string>();

  // Given up by the backend's count (`docs/backend/spec.md :: I480`): stamped unmailed rather than claimed
  // for ever, and this line is all that says who was never told, by count and never by address.
  if (aenderung.aufgegeben) {
    offen.delete(aenderung.id);
    logger.error("berechtigung.notice_abandoned", undefined, {
      error_code: "FE-MAIL-011",
      art: aenderung.art,
      // Every recipient where this process holds no pass of the row's, a restart among the reasons.
      nicht_erreicht: adressen.filter((adresse) => !erreicht.has(adresse)).length,
    });
    return true;
  }

  const message = buildBerechtigungEmail(zugangsaenderung(aenderung), urheber(aenderung), frontend_config.AUTH_URL);

  let alleErledigt = true;
  // A recipient an earlier pass told is not mailed again: past the provider's day its key collapses nothing.
  for (const adresse of adressen.filter((adresse) => !erreicht.has(adresse))) {
    try {
      // Keyed on the outbox row, so a lapsed claim mailing it again reaches nobody twice inside the
      // provider's day; the body depends on the row alone, which the provider needs to collapse it.
      await sendMail({
        to: adresse,
        ...message,
        // A bounce is then a line an operator reads (`fl_frontend/src/app/api/mail/zustellung/route.ts`).
        tags: { [BERECHTIGUNG_TAG]: BERECHTIGUNG_HINWEIS },
        idempotencyKey: mailIdempotencyKey(["berechtigung", aenderung.id], adresse),
      });
      erreicht.add(adresse);
    } catch (error) {
      // Logged by the mailer itself, and as told: a stack that mails nothing would claim the same rows
      // forever, and a barred address would hold its change unstamped for as long as the ban stands.
      const ausfall = versandAusfallOf(error);
      if (ausfall === "zurueckgehalten" || ausfall === "gesperrt") continue;

      if (!(error instanceof MailRecipientError)) alleErledigt = false;
      // The name alone: a failure on this path routinely carries the address.
      logger.error("berechtigung.notice_failed", undefined, {
        error_code: "FE-MAIL-009",
        name: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  // Every other failure keeps the row, a provider's refusal included: the provider names none that
  // concerns one address alone, and a key, a domain or a sender it refuses refuses every send.
  if (alleErledigt) {
    offen.delete(aenderung.id);
    return true;
  }

  offen.set(aenderung.id, erreicht);
  return false;
}

/**
 * A change as the notice words it. An address repointed under one id reaches here as two changes, its
 * removal and the new address's grant, so a `geaendert` is a change of tier alone.
 */
function zugangsaenderung(aenderung: FLBerechtigungAenderung): Zugangsaenderung {
  if (aenderung.art === "entzogen") return { art: "entzogen", adresse: aenderung.vorher?.adresse ?? null };

  return { art: aenderung.art, adresse: aenderung.jetzt?.adresse ?? null, inhaber: aenderung.jetzt?.verwaltung === "owner" };
}

/** Read off `urheber`, never off a null actor: a barred administrator's change is no database edit. */
function urheber(aenderung: FLBerechtigungAenderung): Urheber {
  if (aenderung.urheber === "datenbank") return null;

  return { von: aenderung.geaendert_von_gesperrt ? null : aenderung.geaendert_von, am: aenderung.geaendert_am };
}

/** Which half stopped and the error's name, never a person. */
function logAbgleichFailure(event: "berechtigung.abgleich_failed" | "berechtigung.stempel_failed", error: unknown): void {
  logger.error(event, undefined, { error_code: "FE-SWEEP-002", name: error instanceof Error ? error.name : undefined });
}
