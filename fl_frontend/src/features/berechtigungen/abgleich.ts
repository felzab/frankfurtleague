import "server-only";

import { createHash } from "node:crypto";

import { buildBerechtigungEmail } from "@/core/berechtigungEmail";
import { BERECHTIGUNG_HINWEIS, BERECHTIGUNG_TAG } from "@/core/berechtigungTag";
import { frontend_config } from "@/core/config";
import { renderMail } from "@/core/emailShell";
import { requestOf } from "@/core/errors";
import { logger } from "@/core/logging";
import { MailRecipientError, sendMail } from "@/core/mail";
import { mailIdempotencyKey } from "@/core/mailIdempotencyKey";
import { versandAusfallOf } from "@/core/versandAusfall";

import { postBerechtigungenAbgleich, postBerechtigungenAngekuendigt } from "./mutations";

import type { Urheber, Vorenthalten, Zugangsaenderung } from "@/core/berechtigungEmail";
import type { Mail } from "@/core/emailShell";
import type { FLBerechtigungAenderung } from "./schemas";

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
 * claimed would otherwise wait for the next one. Run by the hourly scheduler
 * (`fl_frontend/src/instrumentation-node.ts :: armScheduler`), which reaches every change to the grants, one made
 * in the database directly included, and behind each response that made one. Settles rather than throws: nothing
 * awaits it behind a response.
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
    logger.warn("berechtigung.abgleich_uebersprungen", { anzahl: claim.uebersprungen });
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
  // Stamped, mailed to nobody: the league sends no notice of these kinds.
  const { art } = aenderung;
  if (istOhneMail(art)) {
    offen.delete(aenderung.id);
    return true;
  }

  const genannt = [aenderung.jetzt?.adresse, aenderung.vorher?.adresse].filter((adresse) => adresse !== null && adresse !== undefined);
  // A request goes to whoever could approve it alone: neither the address it is for nor whoever asked.
  const adressen = [...new Set(aenderung.an ?? [...empfaenger, ...genannt])];
  const erreicht = offen.get(aenderung.id) ?? new Set<string>();

  // Given up by the backend's count: stamped unmailed rather than claimed
  // for ever, and this line is all that says who was never told, by count and never by address.
  if (aenderung.aufgegeben) {
    offen.delete(aenderung.id);
    logger.error("berechtigung.notice_abandoned", undefined, {
      art: aenderung.art,
      // Every recipient where this process holds no pass of the row's, a restart among the reasons.
      nicht_erreicht: adressen.filter((adresse) => !erreicht.has(adresse)).length,
    });
    return true;
  }

  const message = renderMail(nachricht(aenderung, art));
  // The body a key is reused over: an erasure or a ban committing between two passes rewrites it, and the provider refuses
  // a key reused over another body for its day (`409 invalid_idempotent_request`), the recipient left untold.
  const fassung = createHash("sha256")
    .update(JSON.stringify([message.subject, message.html, message.text]))
    .digest("hex")
    .slice(0, 16);

  let alleErledigt = true;
  // A recipient an earlier pass told is not mailed again: past the provider's day its key collapses nothing.
  for (const adresse of adressen.filter((adresse) => !erreicht.has(adresse))) {
    try {
      // Keyed on the outbox row and its body, so a lapsed claim mailing it again reaches nobody twice inside
      // the provider's day; the body depends on the row alone, which the provider needs to collapse it.
      await sendMail({
        to: adresse,
        ...message,
        // A bounce is then a line an operator reads (`fl_frontend/src/app/api/mail/zustellung/route.ts`).
        tags: { [BERECHTIGUNG_TAG]: BERECHTIGUNG_HINWEIS },
        idempotencyKey: mailIdempotencyKey(["berechtigung", aenderung.id, fassung], adresse),
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

/** The kinds of change the league mails nobody about: an address change waiting on an approval, and a request's end. */
const OHNE_MAIL = ["adresswechsel", "antrag_abgelehnt", "antrag_beendet"] as const;

function istOhneMail(art: FLBerechtigungAenderung["art"]): art is (typeof OHNE_MAIL)[number] {
  return (OHNE_MAIL as readonly string[]).includes(art);
}

/** The message one claimed row sends. */
function nachricht(aenderung: FLBerechtigungAenderung, art: Zugangsaenderung["art"]): Mail {
  return buildBerechtigungEmail(zugangsaenderung(aenderung, art), urheber(aenderung), frontend_config.AUTH_URL);
}

/** A row's address as a notice names it, or why it is withheld. */
function adresseOf(aenderung: FLBerechtigungAenderung, stand: FLBerechtigungAenderung["jetzt"]): string | Vorenthalten {
  // `geloescht` read rather than the null: an erased holder's address is withheld as a barred one's is, and
  // every other withheld grant address is a barred one's.
  return stand?.adresse ?? { vorenthalten: aenderung.geloescht ? "geloescht" : "gesperrt" };
}

/**
 * A change as the notice words it. An address repointed under one id reaches here as two changes, its
 * removal and the new address's grant, so a `geaendert` is a change of tier alone.
 */
function zugangsaenderung(aenderung: FLBerechtigungAenderung, art: Zugangsaenderung["art"]): Zugangsaenderung {
  const stand = art === "entzogen" ? aenderung.vorher : aenderung.jetzt;

  return { art: art, adresse: adresseOf(aenderung, stand), inhaber: stand?.verwaltung === "owner" };
}

/** Read off `urheber`, never off a null actor: a barred administrator's change is no database edit. */
function urheber(aenderung: FLBerechtigungAenderung): Urheber {
  if (aenderung.urheber === "datenbank") return null;

  return { von: aenderung.geaendert_von_gesperrt ? null : aenderung.geaendert_von, am: aenderung.geaendert_am };
}

/** Which half stopped, the error's name and what the call says of its request, never a person. */
function logAbgleichFailure(event: "berechtigung.abgleich_failed" | "berechtigung.stempel_failed", error: unknown): void {
  logger.error(event, undefined, { name: error instanceof Error ? error.name : undefined, ...requestOf(error) });
}
