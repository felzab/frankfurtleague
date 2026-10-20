import "server-only";

import { frontend_config } from "@/core/config";
import { requestOf } from "@/core/errors";
import { logger } from "@/core/logging";
import { sendMail } from "@/core/mail";
import { mailIdempotencyKey } from "@/core/mailIdempotencyKey";
import { revalidateOverLoopback } from "@/core/revalidation";
import {
  buildSpielAnfrageEmail,
  buildSpielEinteilungAufgehobenEmail,
  buildSpielEinteilungEmail,
  buildSpielErinnerungEmail,
  buildSpielNeueAnsetzungEmail,
} from "@/core/spielEmail";
import { SPIELLEITUNG_HINWEIS, SPIELLEITUNG_TAG } from "@/core/spielleitungTag";
import { HOUR_MS } from "@/core/timeUnits";
import { versandAusfallOf } from "@/core/versandAusfall";
import { linkVersandOf, sendZielMail } from "@/features/zustellung/notifications";
import { getGermanTodayStr } from "@/shared/utils/date";
import { formatSpielDatum, formatUhrzeit, NICHT_HINTERLEGT } from "@/shared/utils/format";

import { spielBestaetigungsLink } from "./bestaetigungLink";
import { getSpielbestaetigungSweepSaisons, postSpielbestaetigungSweep, postSpielbestaetigungSweepAngefragt } from "./mutations";

import type { SpielAnsetzungText, SpielEmail } from "@/core/spielEmail";
import type { VersandAusfall } from "@/core/versandAusfall";
import type {
  FLSpielbestaetigungAnsichtAnsetzung,
  FLSpielbestaetigungSweepAnfrage,
  FLSpielbestaetigungSweepEinteilung,
  FLSpielbestaetigungSweepNeueAnsetzung,
  FLSpielbestaetigungSweepSchiedsrichterGewechselt,
  FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzung,
} from "./schemas";

/** One hour, as the other sweeps': every clock here selects on a date, so a shorter interval only asks the backend more often. */
const SWEEP_INTERVAL_MS = HOUR_MS;

/**
 * A minute after start rather than at once: a deploy recreates this container before the backend
 * answers, so an immediate pass would log a failure for nothing.
 */
const SWEEP_START_DELAY_MS = 60 * 1000;

/** The action the mail fan-out logs a refused address under. */
const SWEEP_OPERATION = "spielbestaetigungSweep";

/** What a pass did, summed over the seasons that answered. */
type Zaehler = { geschlossen: number; angefragt: number; erinnert: number; fehlgeschlagen: number };

/**
 * Arms the fixture confirmations' timer for the life of this process.
 *
 * Production runs one frontend container, so one process holds one timer and no cross-process lease
 * is built (`docs/ops/spec.md :: I149`).
 */
export function armSpielSweep(): void {
  const erster = setTimeout(() => void runSpielSweep(), SWEEP_START_DELAY_MS);
  const handle = setInterval(() => void runSpielSweep(), SWEEP_INTERVAL_MS);

  // Unreferenced, so neither a pending first pass nor a tick holds a shutdown open behind it.
  erster.unref();
  handle.unref();
}

/** Whether a pass is still running. Module state, which is per process, and one process holds the timer. */
let laeuft = false;

/**
 * One pass over every season the listing answers, then the fixtures cache's drop.
 *
 * Settles rather than throws: nothing awaits this, so a rejection would surface as an unhandled one
 * an hour after the tick that caused it.
 */
export async function runSpielSweep(): Promise<void> {
  if (laeuft) {
    // A pass slower than the hour would otherwise mail beside itself before either reached its stamp.
    logger.info("spielbestaetigung.sweep_skipped");
    return;
  }

  laeuft = true;
  try {
    await sweepAlleSaisons();
  } finally {
    // On every armed pass, one whose listing failed included (`docs/frontend/spec.md :: I741`).
    await revalidateOverLoopback(["spiele"]);
    laeuft = false;
  }
}

async function sweepAlleSaisons(): Promise<void> {
  let saisonIds: readonly string[];

  try {
    ({ saison_ids: saisonIds } = await getSpielbestaetigungSweepSaisons());
  } catch (error) {
    logSweepFailure(error, undefined);
    return;
  }

  const zaehler: Zaehler = { geschlossen: 0, angefragt: 0, erinnert: 0, fehlgeschlagen: 0 };
  // Season by season and never in parallel: one slow pass costs nothing, where a fan-out would put every
  // season's mail on the transport at once.
  for (const saisonId of saisonIds) {
    try {
      await sweepSaison(saisonId, zaehler);
    } catch (error) {
      logSweepFailure(error, saisonId);
    }
  }

  // A warning where rows were passed over: each pass moves on past them, so only this count tells a pass failing on
  // every row from a healthy one.
  if (zaehler.fehlgeschlagen === 0) logger.info("spielbestaetigung.sweep_pass", zaehler);
  else logger.warn("spielbestaetigung.sweep_pass", { error_code: "FE-SWEEP-004", ...zaehler });
}

/**
 * One season's close, mint and remind, then the messages: a first request mailed before its stamp
 * (`docs/frontend/spec.md :: I742`), a reminder after the stamp the call itself wrote, so a failed send costs one
 * reminder rather than a daily repeat.
 */
async function sweepSaison(saisonId: string, zaehler: Zaehler): Promise<void> {
  const antwort = await postSpielbestaetigungSweep(saisonId);
  // Added as each call answers, so a later call that throws keeps the earlier counts.
  zaehler.geschlossen += antwort.geschlossen;
  zaehler.fehlgeschlagen += antwort.fehlgeschlagen;
  zaehler.erinnert += antwort.erinnerungen.length;

  // First, so a mailbox reads that the earlier request is void before the fresh one for the moved fixture.
  for (const neu of antwort.neue_ansetzungen) await mailNeueAnsetzung(neu);
  for (const neu of antwort.schiedsrichter_neue_ansetzungen) await mailSchiedsrichterNeueAnsetzung(neu);
  // Never stamped, as the move notices are not: the stamp marks a row asked, and this one is closed.
  for (const weg of antwort.schiedsrichter_gewechselt) await mailSchiedsrichterGewechselt(weg);

  for (const erinnerung of antwort.erinnerungen) await mailAnfrage(erinnerung, "erinnerung");

  const angefragt: string[] = [];
  for (const anfrage of antwort.anfragen) {
    if (await mailAnfrage(anfrage, "anfrage")) angefragt.push(anfrage.spielbestaetigung_id);
  }
  for (const einteilung of antwort.einteilungen) {
    if (await mailEinteilung(einteilung)) angefragt.push(einteilung.spielbestaetigung_id);
  }

  if (angefragt.length > 0) {
    const gestempelt = await postSpielbestaetigungSweepAngefragt(saisonId, { spielbestaetigung_ids: angefragt });
    zaehler.angefragt += gestempelt.angefragt;
    zaehler.fehlgeschlagen += gestempelt.fehlgeschlagen;
  }
}

/** One fixture as the messages state it: the dates as the site prints them, a venue nobody assigned in the fixtures' word. */
function ansetzungText(ansetzung: FLSpielbestaetigungAnsichtAnsetzung): SpielAnsetzungText {
  return {
    team1: ansetzung.team1_name,
    team2: ansetzung.team2_name,
    datumText: formatSpielDatum(ansetzung.datum),
    uhrzeitText: formatUhrzeit(ansetzung.uhrzeit),
    ortText: ansetzung.spielort?.name ?? NICHT_HINTERLEGT,
  };
}

/**
 * Whether a request counts as made, on either lane (`docs/frontend/spec.md :: I742`). Production waits for a real send:
 * withheld there is a deployment missing its key, and stamping it would turn a party nobody asked into a silent one.
 */
function istAngefragt(versand: "gesendet" | VersandAusfall): boolean {
  if (versand === "gesendet" || versand === "gesperrt") return true;

  return versand === "zurueckgehalten" && frontend_config.APP_ENV !== "production";
}

/**
 * One message per link, each to the mailbox holding it: a row counts as asked once any of its links went. The
 * deadline is the row's own, as the endpoint answered it, and never one reckoned here.
 */
async function mailAnfrage(anfrage: FLSpielbestaetigungSweepAnfrage, art: "anfrage" | "erinnerung"): Promise<boolean> {
  // The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL` (`docs/frontend/spec.md :: I186`).
  const origin = frontend_config.AUTH_URL;
  const ansetzung = ansetzungText(anfrage.ansetzung);
  const team = anfrage.seite === "team1" ? anfrage.ansetzung.team1_name : anfrage.ansetzung.team2_name;
  const bauen = art === "anfrage" ? buildSpielAnfrageEmail : buildSpielErinnerungEmail;
  let angefragt = false;

  for (const { address, rollen, token } of anfrage.links) {
    const [erste, ...weitere] = rollen;
    // The wire can carry an empty list where the delivery record's type cannot.
    if (erste === undefined) continue;

    const ergebnis = await sendZielMail({
      operation: SWEEP_OPERATION,
      // No idempotency key: every request carries a token minted for it, so one key over two bodies would be refused.
      auftrag: { ziel: "spielbestaetigung", zielId: anfrage.spielbestaetigung_id, anlass: art, rollen: [erste, ...weitere] },
      recipients: [address],
      buildMail: () =>
        bauen({
          origin: origin,
          link: spielBestaetigungsLink(origin, token),
          team: team,
          ansetzung: ansetzung,
          fristText: formatSpielDatum(anfrage.frist),
        }),
    });
    angefragt = angefragt || istAngefragt(linkVersandOf(ergebnis));
  }

  return angefragt;
}

/** The team's word that a fixture it was asked about moved, to every mailbox the row's seats hold now. */
async function mailNeueAnsetzung(neu: FLSpielbestaetigungSweepNeueAnsetzung): Promise<void> {
  for (const { address, rollen } of neu.empfaenger) {
    const [erste, ...weitere] = rollen;
    if (erste === undefined) continue;

    await sendZielMail({
      operation: SWEEP_OPERATION,
      // Keyed on the day: this body carries no link, so a pass that mailed and then failed composes the same message.
      auftrag: {
        ziel: "spielbestaetigung",
        zielId: neu.spielbestaetigung_id,
        anlass: "neue_ansetzung",
        rollen: [erste, ...weitere],
        idempotenzTag: getGermanTodayStr(),
      },
      recipients: [address],
      buildMail: () =>
        buildSpielNeueAnsetzungEmail({
          origin: frontend_config.AUTH_URL,
          team1: neu.team1_name,
          team2: neu.team2_name,
          altDatumText: formatSpielDatum(neu.alt.datum),
          altUhrzeitText: formatUhrzeit(neu.alt.uhrzeit),
          empfaenger: "team",
        }),
    });
  }
}

async function mailSchiedsrichterNeueAnsetzung(neu: FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzung): Promise<void> {
  await mailSpielleitung(neu.address, ["neue_ansetzung", neu.spielbestaetigung_id], () =>
    buildSpielNeueAnsetzungEmail({
      origin: frontend_config.AUTH_URL,
      team1: neu.team1_name,
      team2: neu.team2_name,
      altDatumText: formatSpielDatum(neu.alt.datum),
      altUhrzeitText: formatUhrzeit(neu.alt.uhrzeit),
      empfaenger: "schiedsrichter",
    }),
  );
}

async function mailSchiedsrichterGewechselt(weg: FLSpielbestaetigungSweepSchiedsrichterGewechselt): Promise<void> {
  await mailSpielleitung(weg.address, ["schiedsrichter_gewechselt", weg.spielbestaetigung_id], () =>
    buildSpielEinteilungAufgehobenEmail({
      origin: frontend_config.AUTH_URL,
      team1: weg.team1_name,
      team2: weg.team2_name,
      altDatumText: formatSpielDatum(weg.alt.datum),
      altUhrzeitText: formatUhrzeit(weg.alt.uhrzeit),
    }),
  );
}

async function mailEinteilung(einteilung: FLSpielbestaetigungSweepEinteilung): Promise<boolean> {
  const versand = await mailSpielleitung(einteilung.address, ["einteilung", einteilung.spielbestaetigung_id], () =>
    buildSpielEinteilungEmail({ origin: frontend_config.AUTH_URL, ansetzung: ansetzungText(einteilung.ansetzung) }),
  );

  return istAngefragt(versand);
}

/** One message to a referee, on the lane no record holds (`fl_frontend/src/core/spielleitungTag.ts :: SPIELLEITUNG_TAG`). */
async function mailSpielleitung(address: string, scope: readonly string[], bauen: () => SpielEmail): Promise<"gesendet" | VersandAusfall> {
  try {
    await sendMail({
      to: address,
      ...bauen(),
      tags: { [SPIELLEITUNG_TAG]: SPIELLEITUNG_HINWEIS },
      // The day in the key: the body carries no token and cannot change inside the provider's window.
      idempotencyKey: mailIdempotencyKey([...scope, getGermanTodayStr()], address),
    });
    return "gesendet";
  } catch (error) {
    const ausfall = versandAusfallOf(error);
    // A barred or a withheld message is the mailer's own line, as on every lane.
    if (ausfall === "gesperrt" || ausfall === "zurueckgehalten") return ausfall;
    // Name only, never the error: its message can carry the address (`docs/logging/spec.md :: L9`).
    logger.error("spielbestaetigung.spielleitung_failed", undefined, {
      error_code: "FE-MAIL-002",
      name: error instanceof Error ? error.name : undefined,
      operation: SWEEP_OPERATION,
    });
    return ausfall;
  }
}

/** The season and the error's name, never a person: this line is written for a season nobody swept. */
function logSweepFailure(error: unknown, saisonId: string | undefined): void {
  logger.error("spielbestaetigung.sweep_failed", undefined, {
    error_code: "FE-SWEEP-004",
    name: error instanceof Error ? error.name : undefined,
    ...requestOf(error),
    saison_id: saisonId,
  });
}
