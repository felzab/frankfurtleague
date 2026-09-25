import { registerHooks } from "node:module";
import { beforeEach } from "node:test";

/** One message handed to the mailer, as `fl_frontend/src/core/mail.ts :: OutboundMail` carries it. */
export type SentMail = { to: string; subject: string; html: string; text: string; tags?: Record<string, string>; idempotencyKey?: string };

/**
 * How the mailer ends one message. `withheld` and `recipient` are raised before any attempt, so no
 * write is recorded; `accepted`, `refused` and `lost` answer an attempt, which records one.
 */
export type MailOutcome = "withheld" | "recipient" | "accepted" | "refused" | "lost";

type MailAnswer = (mail: SentMail) => MailOutcome | Promise<MailOutcome>;

let registered = 0;

/**
 * Stands in for `fl_frontend/src/core/mail.ts` alone: the real fan-outs send through it, so the write
 * record a suite reads is the one the mailer and the fan-out leave together.
 */
export function doubleSendMail(): { sent: SentMail[]; answerWith: (next: MailAnswer) => void } {
  const sent: SentMail[] = [];
  const accepted: MailAnswer = () => "accepted";
  let answering = accepted;
  // Through a global: the replaced module is compiled from source and shares nothing with this scope.
  const bus = `__flMailDouble${String((registered += 1))}`;
  Reflect.set(globalThis, bus, { sent, answer: (mail: SentMail) => answering(mail) });

  // The three classes the real module declares, with its names and sentences; the two it imports
  // from `errors.ts` are the real ones, which the fan-outs sort a failure by.
  const source = `import { APINetworkError, MailSendError } from "@/core/errors";
import { recordWriteSent } from "@/core/requestScope";
const PROVIDER = "https://provider.invalid/emails";
export class MailWithheldError extends Error {
  constructor() { super("This deployment does not send mail."); this.name = "MailWithheldError"; }
}
export class MailRecipientError extends Error {
  constructor() { super("The recipient's domain cannot be written in ASCII."); this.name = "MailRecipientError"; }
}
export class MailUnsentError extends Error {
  constructor() { super("The request's deadline had passed before the message was sent."); this.name = "MailUnsentError"; }
}
export const sendMail = async (mail) => {
  const bus = globalThis.${bus};
  bus.sent.push(mail);
  const outcome = await bus.answer(mail);
  if (outcome === "withheld") throw new MailWithheldError();
  if (outcome === "recipient") throw new MailRecipientError();
  recordWriteSent();
  if (outcome === "refused") throw new MailSendError({ message: "The mail provider refused the message.", url: PROVIDER, statusCode: 422, traceId: "0" });
  if (outcome === "lost") throw new APINetworkError({ message: "Mail request failed.", url: PROVIDER, method: "POST", readOnly: false, traceId: "0", isTimeout: false });
  return { id: "msg-" + String(bus.sent.length) };
};`;

  registerHooks({
    load(url, context, nextLoad) {
      // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
      return url.endsWith("/src/core/mail.ts") ? { format: "module", source, shortCircuit: true } : nextLoad(url, context);
    },
  });

  // Back to accepted before every case: a case that named a refusal would hand it to the next case's message.
  beforeEach(() => {
    sent.length = 0;
    answering = accepted;
  });

  return { sent, answerWith: (next) => void (answering = next) };
}
