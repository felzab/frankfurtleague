import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { symmetricDecrypt } from "better-auth/crypto";

import { KONTAKT_EMAIL } from "./brand";
import { authResendKey, authSecret, frontend_config } from "./config";
import { COPY } from "./copy";
import { isOneBareMailbox, withAsciiDomain } from "./emailAddress";
import { renderMail } from "./emailShell";
import { APINetworkError, MailSendError } from "./errors";
import { postausgangPostAusgabe, postausgangPostErgebnis } from "./generated/client/sdk";
import { logger } from "./logging";
import { mailFor, POSTAUSGANG_TAG } from "./mailKinds";
import { boundCall, getRequestTraceId, recordWriteSent } from "./requestScope";
import { mintTraceId } from "./trace";

import type { MailVon } from "./emailShell";
import type {
  FLPostausgangAusgabe,
  FLPostausgangErgebnisPayload,
  FLPostausgangErgebnisPayloadErgebnis,
  FLPostausgangErgebnisResponse,
} from "./generated/client/types";

const MAIL_ENDPOINT = "https://api.resend.com/emails";

// Two senders: sign-in codes and security notices from one address, everything else from the
// other, the mail's kind choosing (`fl_frontend/src/core/emailShell.ts :: MailVon`). Each address
// needs its own routing rule and its sender alignment at the provider.
const ABSENDER: Readonly<Record<MailVon, string>> = {
  anmeldung: "anmeldung@frankfurtleague.de",
  liga: "liga@frankfurtleague.de",
};

/** Every sender under the league's name, which needs no quoting: it holds no comma, quote or angle bracket. */
function absenderZeile(von: MailVon): string {
  return `${COPY.marke.name} <${ABSENDER[von]}>`;
}

/** Every reply reaches the league's mailbox, whichever address sent the mail. */
const ANTWORT_AN = KONTAKT_EMAIL;

// Bounds the WHOLE call the way `fl_frontend/src/core/api.ts :: FETCH_TIMEOUT_MS` bounds a
// backend call: a per-attempt budget would multiply by the attempts below, and the application-form
// notices are awaited inside an admin's own save.
const MAIL_TIMEOUT_MS = 15000;

/** Three, because the provider's own transient set is a rate limit or a blip and neither clears on the instant. */
const MAIL_ATTEMPTS = 3;

/** Long enough for a per-second rate limit to refill, short enough that three attempts stay inside the budget. */
const MAIL_RETRY_DELAY_MS = 400;

// `.gitignore` and `.prettierignore` both hold `.tmp-*/`, and a name outside that pattern is one git
// offers to commit -- with a sign-in code, a bearer credential, inside it.
const MAIL_SINK_DIR = ".tmp-mail";

/** Long enough for the biggest fan-out this application draws, short enough to end rather than spin. */
const SINK_NAME_ATTEMPTS = 20;

const SINK_SLUG_MAX = 40;

interface OutboundMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Which of the two senders, read off the mail's kind by `fl_frontend/src/core/emailShell.ts :: renderMail`. */
  von: MailVon;
  /**
   * Rides the send and comes back on every delivery event about it, which is what routes one back to
   * the row it was sent from. Each name and value must be ASCII letters, digits, `_` or `-`.
   */
  tags: Record<string, string>;
  /**
   * Collapses a repeat of the same send inside the provider's 24-hour window, answering the original
   * id rather than sending again. A key reused with a DIFFERENT body is refused rather than ignored.
   */
  idempotencyKey: string;
}

/**
 * `null` where an accepted answer carried no id: the message went out, and no later delivery event
 * can be joined to it.
 */
type MailAccepted = { id: string | null };

/**
 * Raised where the deployment does not mail. Not a `MailSendError` and not in `errors.ts`: nothing
 * here reached a provider, so there is no status to carry and no retry decision to read off one.
 */
class MailWithheldError extends Error {
  constructor() {
    super("This deployment does not send mail.");

    this.name = "MailWithheldError";
  }
}

/**
 * Raised where the recipient is not one bare mailbox, or its domain has no ASCII form. Beside
 * `MailWithheldError` rather than in `errors.ts` for its reason, and carrying no address for the same one.
 */
class MailRecipientError extends Error {
  constructor() {
    super("The recipient is not one mailbox with an ASCII domain.");

    this.name = "MailRecipientError";
  }
}

/**
 * Nothing reached the provider: the request's deadline ran out first, which writes a line of its own. Not an
 * `APINetworkError`, which may be a message that went.
 */
class MailUnsentError extends Error {
  constructor() {
    super("Nothing reached the provider, so the message was not sent.");

    this.name = "MailUnsentError";
  }
}

/** The errno token where a failure carries one — `EEXIST`, `EACCES` — and nothing else. */
function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

/** Sorts by name into the order the messages were written, and Windows takes no colon in a file name. */
function sinkFileStem(subject: string, at: Date): string {
  const stamp = at.toISOString().replaceAll(":", "-");
  // Folded rather than dropped, so a German subject reaches the stem whole rather than broken at the
  // letter: `ß` is the one NFKD leaves standing, and the separator run below would eat it.
  const slug = subject
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replaceAll("ß", "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, SINK_SLUG_MAX)
    .replace(/^-+|-+$/g, "");

  return slug === "" ? stamp : `${stamp}-${slug}`;
}

/** A comment terminator and nothing else: the rest of the text part has to survive byte for byte. */
function forComment(value: string): string {
  return value.replaceAll("-->", "--&gt;").replaceAll("--!>", "--!&gt;");
}

function sinkDocument({ to, subject, html, text, von, tags }: OutboundMail, traceId: string): string {
  const pairs = Object.entries(tags).map(([name, value]) => `${name}=${value}`);
  const header = [
    `From: ${absenderZeile(von)}`,
    `Reply-To: ${ANTWORT_AN}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    ...(pairs.length === 0 ? [] : [`Tags: ${pairs.join("; ")}`]),
    `Trace: ${traceId}`,
    "",
    text,
  ];

  // Ahead of the message rather than around it: a browser hoists markup written before `<html>` into
  // the body, where a banner would sit on the message's own ground and stop this being what renders.
  return `<!--\n${forComment(header.join("\n"))}\n-->\n${html}`;
}

/**
 * Files the message where a developer reads it. **Never throws**: the send is refused either way, and a
 * sink failure taking the refusal's place would report a message as sent.
 */
async function writeToSink(message: OutboundMail, traceId: string): Promise<void> {
  const directory = path.join(process.cwd(), MAIL_SINK_DIR);
  const stem = sinkFileStem(message.subject, new Date());

  try {
    await mkdir(directory, { recursive: true });

    for (let attempt = 1; attempt <= SINK_NAME_ATTEMPTS; attempt++) {
      const name = attempt === 1 ? `${stem}.html` : `${stem}-${String(attempt)}.html`;
      try {
        // `wx`, because one application's three contact people are three messages inside one
        // millisecond: an overwrite here would report two of them as never rendered.
        await writeFile(path.join(directory, name), sinkDocument(message, traceId), { encoding: "utf8", flag: "wx" });

        return;
      } catch (error) {
        if (errnoCode(error) !== "EEXIST") throw error;
      }
    }

    throw new Error("No unused name was left for the message.");
  } catch (error) {
    // The errno token, never the thrown message, which carries the path: the line says which failure
    // to fix without naming a directory the developer is about to be told to open anyway.
    logger.error("mail.sink_failed", undefined, {
      error_name: errnoCode(error) ?? (error instanceof Error ? error.name : "unknown"),
      trace_id: traceId,
    });
  }
}

/** Resolves on the delay, or at once when the whole call's budget has already run out. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const handle = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(handle);
      resolve();
    });
  });
}

/**
 * The row's address as the provider is handed it: one bare mailbox, its domain in ASCII. The ban was judged at the
 * hand-out, on the stored spelling.
 */
function recipientOf(to: string): string {
  // A domain IDNA cannot convert, and any spelling around a mailbox, which the provider would still reach the mailbox
  // inside.
  const converted = withAsciiDomain(to);
  if (converted === undefined || !isOneBareMailbox(converted)) throw new MailRecipientError();

  return converted;
}

/** What drains settled: the backend's counts, summed over every report they made. */
type DrainZaehlung = Record<keyof FLPostausgangErgebnisResponse, number>;

const keine = (): DrainZaehlung => ({ gesendet: 0, wiederholt: 0, aufgegeben: 0, zurueckgehalten: 0, ignoriert: 0 });

/** Every drain's counts since the hourly pass last took them, whichever started the drain: a write's or the pass. */
let seitDemLetztenDurchlauf = keine();

/**
 * What every drain in this process settled since the last call, `aufgegeben` the mails the heartbeat reports: a mail is
 * given up by whichever drain meets it, and most drains are a write's.
 */
export function takeDrainCounts(): DrainZaehlung {
  const genommen = seitDemLetztenDurchlauf;
  seitDemLetztenDurchlauf = keine();

  return genommen;
}

/** The one drain this process runs, and the one every call made while it runs waits on. */
let drainLaeuft: Promise<void> | undefined;
let drainDanach: Promise<void> | undefined;

/**
 * Every mail owed now: claimed a page at a time, each sent, and each outcome reported as its send returns, so a drain
 * cut short leaves no sent mail unreported but the one in flight. What it settled joins `takeDrainCounts`.
 *
 * One drain at a time in this process: a call while one runs waits on the next, started once that one settles however
 * it settles. Rejects where a hand-out or a report fails, the rows it held going to the next drain once their lease
 * lapses.
 */
export function drainPostausgang(): Promise<void> {
  if (drainLaeuft !== undefined) {
    // Started from this call's context, so it runs under this call's scope rather than the running drain's, whose
    // deadline may be what that drain failed on.
    const danach = () => {
      drainDanach = undefined;
      return drainPostausgang();
    };
    drainDanach ??= drainLaeuft.then(danach, danach);
    return drainDanach;
  }

  const lauf = drainen().finally(() => {
    drainLaeuft = undefined;
  });
  drainLaeuft = lauf;

  return lauf;
}

/** Claims until a claim holds nothing: a mail handed back to wait its minute is no longer free, so the loop ends. */
async function drainen(): Promise<void> {
  for (;;) {
    const { beanspruchung, mails, aufgegeben } = await postausgangPostAusgabe();
    seitDemLetztenDurchlauf.aufgegeben += aufgegeben;
    if (beanspruchung === null) return;

    for (const mail of mails) {
      const antwort = await postausgangPostErgebnis({ beanspruchung: beanspruchung, ...(await zustellen(mail)) });
      for (const feld of Object.keys(antwort) as (keyof DrainZaehlung)[]) seitDemLetztenDurchlauf[feld] += antwort[feld];
    }
  }
}

/**
 * One handed-out mail, rendered from its row and sent under the hand-out's own idempotency key: the provider collapses a
 * repeat of this send, and a later hand-out mints a fresh link under a key of its own
 * (https://resend.com/docs/dashboard/emails/idempotency-keys). The ban was judged at the hand-out.
 */
async function zustellen(mail: FLPostausgangAusgabe): Promise<Omit<FLPostausgangErgebnisPayload, "beanspruchung">> {
  // Opened here alone, sealed by `fl_frontend/src/core/auth.ts :: oweSignInMail` under the same key, and held by this
  // scope alone: never on a line, never in an error.
  let geheim: string | null = null;
  try {
    if (mail.geheim !== null) geheim = await symmetricDecrypt({ key: authSecret(), data: mail.geheim });
  } catch (error) {
    // Given up rather than thrown: sealed under a key since replaced, the row would stop every drain until it lapses,
    // each claiming it first. The error's name alone, which quotes no value.
    logger.error("postausgang.geheim_unlesbar", undefined, { art: mail.daten.art, name: error instanceof Error ? error.name : undefined });
    return { id: mail.id, ergebnis: "aufgeben", nachricht_id: null };
  }
  const nachricht = mailFor(mail.daten.art, mail.daten, { token: mail.token, geheim: geheim, origin: frontend_config.AUTH_URL });
  if (nachricht === undefined) {
    // Handed back rather than given up: the row waits until its deadline for a deployment that builds its kind.
    logger.error("postausgang.art_ohne_vorlage", undefined, { art: mail.daten.art });
    return { id: mail.id, ergebnis: "wiederholen", nachricht_id: null };
  }

  try {
    const { id } = await deliver({
      to: recipientOf(mail.an),
      ...renderMail(nachricht),
      tags: { [POSTAUSGANG_TAG]: mail.id },
      idempotencyKey: `postausgang/${mail.id}/${String(mail.versuch)}`,
    });
    return { id: mail.id, ergebnis: "gesendet", nachricht_id: id };
  } catch (error) {
    return { id: mail.id, ergebnis: ergebnisOf(error), nachricht_id: null };
  }
}

/**
 * A failed send's outcome. A refusal the provider names temporary, its quota among them, a send that broke off and one
 * that never left are tried again and never count toward giving up; any other refusal is one every send would meet.
 */
function ergebnisOf(error: unknown): Exclude<FLPostausgangErgebnisPayloadErgebnis, "gesendet"> {
  if (error instanceof MailWithheldError) return "zurueckgehalten";
  if (error instanceof MailRecipientError) return "aufgeben";
  if (error instanceof MailSendError) return error.isTransient ? "wiederholen" : "aufgeben";
  if (error instanceof APINetworkError || error instanceof MailUnsentError) return "wiederholen";

  // A fault of this code rather than of the send: the drain stops, and the row returns once its lease lapses.
  throw error;
}

/**
 * The one call against the mail provider, the drain's alone. **A refusal never carries the
 * provider's message**, which names the recipient -- `fl_frontend/src/core/errors.ts :: MailSendError`
 * takes the stable `name` field instead.
 */
async function deliver({ to, subject, html, text, von, tags, idempotencyKey }: OutboundMail): Promise<MailAccepted> {
  const traceId = getRequestTraceId() ?? mintTraceId();

  // Both halves fail closed: the deployment says it is not the one that mails, and outside
  // `production` no key is demanded to authorise one. A local stack's database is a production
  // dump, so its addresses are real people.
  const apiKey = authResendKey();
  if (frontend_config.APP_ENV !== "production" || apiKey === undefined) {
    // Never on production, which reaches this arm only where `SKIP_ENV_VALIDATION` stood the key's
    // requirement down: a file there would leave a live sign-in code on the host's disk.
    if (frontend_config.APP_ENV !== "production") await writeToSink({ to, subject, html, text, von, tags, idempotencyKey }, traceId);

    // No line of its own: the row's `zurueckgehalten` is the record, and the filed copy carries the row's id among its tags.
    throw new MailWithheldError();
  }

  const signal = boundCall(MAIL_TIMEOUT_MS);

  const failNetwork = (error: unknown) =>
    new APINetworkError({
      message: "Mail request failed.",
      isTimeout: error instanceof Error && error.name === "TimeoutError",
      url: MAIL_ENDPOINT,
      method: "POST",
      readOnly: false,
      traceId: traceId,
      originalError: error,
    });

  // Logged where the detail exists: a caller on the sign-in path records the error's NAME alone, so
  // a status and the provider's code reach no stream otherwise. The recipient never travels on
  // either line.
  const logNetwork = (failure: APINetworkError) => {
    logger.error("mail.send_failed", undefined, {
      is_timeout: failure.isTimeout,
      trace_id: traceId,
    });
  };

  const headers: Record<string, string> = {
    // The narrowed local, never the config read again: a template literal renders an absent key as
    // `Bearer undefined` and the type checker says nothing.
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
  };

  const body = JSON.stringify({
    from: absenderZeile(von),
    reply_to: ANTWORT_AN,
    to: to,
    subject,
    html,
    text,
    tags: Object.entries(tags).map(([name, value]) => ({ name: name, value: value })),
  });

  const attempt = async (): Promise<MailAccepted> => {
    let res: Response;
    // A message is a write nothing takes back, and one whose answer never comes may still have gone. No
    // attempt starts on a spent deadline: the checks before the first and after each pause refuse it.
    recordWriteSent();
    try {
      res = await fetch(MAIL_ENDPOINT, { method: "POST", headers: headers, body: body, signal: signal });
    } catch (error) {
      throw failNetwork(error);
    }

    if (res.ok) {
      let id: string | null = null;
      try {
        const accepted: unknown = await res.json();
        id = accepted && typeof accepted === "object" && "id" in accepted ? String(accepted.id) : null;
      } catch (error) {
        // A stalled body aborts here rather than inside `fetch`. An unreadable one still leaves a
        // message that WENT: reporting the send as failed would take a decision back that stands.
        if (error instanceof Error && error.name === "TimeoutError") throw failNetwork(error);
      }

      return { id: id };
    }

    let providerErrorName: string | undefined;
    try {
      const refused: unknown = await res.json();
      providerErrorName = refused && typeof refused === "object" && "name" in refused ? String(refused.name) : undefined;
    } catch (error) {
      // A stalled body aborts here rather than inside `fetch`, as it does in
      // `fl_frontend/src/core/api.ts :: sendToBackend`. An unparseable one is left to the status alone.
      if (error instanceof Error && error.name === "TimeoutError") throw failNetwork(error);
    }

    throw new MailSendError({
      message: "The mail provider refused the message.",
      url: MAIL_ENDPOINT,
      statusCode: res.status,
      providerErrorName: providerErrorName,
      traceId: traceId,
    });
  };

  /** The line a refusal nobody will retry leaves. `failNetwork` writes its own, so this one is the provider's alone. */
  const logRefusal = (refusal: MailSendError) => {
    logger.error("mail.send_failed", undefined, {
      status: refusal.statusCode,
      provider_error_name: refusal.providerErrorName,
      trace_id: traceId,
    });
  };

  // Refused unsent once the request's deadline is spent.
  if (signal.aborted) {
    logger.error("mail.send_failed", undefined, { is_timeout: true, trace_id: traceId });
    throw new MailUnsentError();
  }

  /** The line a failure nobody will retry leaves, the provider's refusal or the broken request. */
  const logGivenUp = (error: unknown) => {
    if (error instanceof MailSendError) logRefusal(error);
    else if (error instanceof APINetworkError) logNetwork(error);
  };

  // The first attempt that broke off, which the provider may have accepted: a refusal answering a
  // later attempt says nothing about it, so the send ends as that network failure, of unknown outcome.
  let brokeOff: APINetworkError | undefined;
  const giveUp = (error: unknown): never => {
    logGivenUp(error);
    // A last attempt that broke off is already the network failure to end on, and its line is written.
    if (brokeOff === undefined || error instanceof APINetworkError) throw error;

    logNetwork(brokeOff);
    throw brokeOff;
  };

  for (let attemptNumber = 1; ; attemptNumber++) {
    try {
      return await attempt();
    } catch (error) {
      if (error instanceof APINetworkError) brokeOff ??= error;

      // A network failure is tried again under the send's idempotency key, which the provider documents as
      // collapsing the repeat of a message it accepted before the connection broke.
      const repeatable = error instanceof MailSendError ? error.isTransient : error instanceof APINetworkError;

      // An aborted budget ends it too: the timeout that cut the attempt leaves nothing to retry in.
      if (!repeatable || attemptNumber >= MAIL_ATTEMPTS || signal.aborted) giveUp(error);

      logger.warn("mail.send_retried", {
        status: error instanceof MailSendError ? error.statusCode : undefined,
        provider_error_name: error instanceof MailSendError ? error.providerErrorName : undefined,
        trace_id: traceId,
      });

      await pause(MAIL_RETRY_DELAY_MS, signal);

      // The budget ran out mid-wait. Attempting anyway would draw a request the aborted signal
      // kills, reporting the provider's own refusal as this application's timeout.
      if (signal.aborted) giveUp(error);
    }
  }
}
