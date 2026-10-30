import { symmetricDecrypt } from "better-auth/crypto";
import { assert, beforeEach, vi } from "vitest";

import { APINetworkError, MailSendError } from "@/core/errors.ts";
import { recordWriteSent } from "@/core/requestScope.ts";

import type { MailVon } from "@/core/emailShell.ts";
import type { FLPostausgangAnmeldungPayload } from "@/core/generated/client/types.ts";

/** One message handed to the mailer, as `fl_frontend/src/core/mail.ts :: OutboundMail` carries it. */
export type SentMail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  tags?: Record<string, string>;
  idempotencyKey?: string;
  von: MailVon;
};

/** What `fl_frontend/src/core/mail.ts :: sendSperreNotice` is handed: the address and the ban's own facts. */
type SperreFacts = { to: string; grund: string; gesperrtBisSaisonId: string; origin: string };

/**
 * How the mailer ends one message. `barred`, `withheld`, `recipient` and `unsent` are raised before
 * any attempt, so no write is recorded; an acceptance, a refusal and `lost` answer an attempt, which
 * records one.
 */
export type MailOutcome =
  | "barred"
  | "withheld"
  | "recipient"
  | "unsent"
  | "accepted"
  | "refused"
  | "lost"
  // Accepted under this id, `null` where the provider's answer named none: `accepted` mints one of its own.
  | { accepted: string | null }
  // Refused at this status, with the provider's token where its body carried one: `refused` is a 422 carrying none.
  | { refused: number; providerErrorName?: string };

type MailAnswer = (mail: SentMail) => MailOutcome | Promise<MailOutcome>;

const PROVIDER = "https://provider.invalid/emails";

const BACKEND = "https://backend.invalid/api/v1/postausgang/anmeldung";

// The four classes the real module declares, with its names and sentences; the two the double
// throws from `errors.ts` are the real ones, which the fan-outs sort a failure by.
class MailBarredError extends Error {
  constructor() {
    super("The recipient is on the ban list.");
    this.name = "MailBarredError";
  }
}

class MailWithheldError extends Error {
  constructor() {
    super("This deployment does not send mail.");
    this.name = "MailWithheldError";
  }
}

class MailRecipientError extends Error {
  constructor() {
    super("The recipient is not one mailbox with an ASCII domain.");
    this.name = "MailRecipientError";
  }
}

class MailUnsentError extends Error {
  constructor() {
    super("Nothing reached the provider, so the message was not sent.");
    this.name = "MailUnsentError";
  }
}

/**
 * Stands in for `fl_frontend/src/core/mail.ts` alone: the real fan-outs send through it, so the write
 * record a suite reads is the one the mailer and the fan-out leave together. `notices` is the share
 * of `sent` the ban notice's own sender took.
 */
export function doubleSendMail(): {
  sent: SentMail[];
  notices: SentMail[];
  owed: FLPostausgangAnmeldungPayload[];
  answerWith: (next: MailAnswer) => void;
} {
  const sent: SentMail[] = [];
  const notices: SentMail[] = [];
  // Every sign-in mail owed through the Postausgang, as the backend was handed it.
  const owed: FLPostausgangAnmeldungPayload[] = [];
  const accepted: MailAnswer = () => "accepted";
  let answering = accepted;

  const settle = async (mail: SentMail): Promise<{ id: string | null }> => {
    const outcome = await answering(mail);
    if (outcome === "barred") throw new MailBarredError();
    if (outcome === "withheld") throw new MailWithheldError();
    if (outcome === "recipient") throw new MailRecipientError();
    if (outcome === "unsent") throw new MailUnsentError();
    recordWriteSent();
    const refusal = outcome === "refused" ? { refused: 422 } : outcome;
    if (typeof refusal === "object" && "refused" in refusal) {
      throw new MailSendError({
        message: "The mail provider refused the message.",
        url: PROVIDER,
        statusCode: refusal.refused,
        providerErrorName: "providerErrorName" in refusal ? refusal.providerErrorName : undefined,
        traceId: "0",
      });
    }
    if (outcome === "lost") {
      throw new APINetworkError({
        message: "Mail request failed.",
        url: PROVIDER,
        method: "POST",
        readOnly: false,
        traceId: "0",
        isTimeout: false,
      });
    }
    return { id: typeof outcome === "object" && "accepted" in outcome ? outcome.accepted : `msg-${String(sent.length)}` };
  };

  const sendMail = async (mail: SentMail): Promise<{ id: string | null }> => {
    sent.push(mail);
    return settle(mail);
  };

  // Composed by the real builder, as the real sender composes it: a case reads the notice's words.
  const sendSperreNotice = async ({ to, ...facts }: SperreFacts): Promise<{ id: string | null }> => {
    const { buildSperreEmail } = await import("@/core/sperrlisteEmail.ts");
    const { renderMail } = await import("@/core/emailShell.ts");
    const notice = { to: to, ...renderMail(buildSperreEmail(facts)) };
    sent.push(notice);
    notices.push(notice);
    return settle(notice);
  };

  const doubled = { MailBarredError, MailWithheldError, MailRecipientError, MailUnsentError, sendMail, sendSperreNotice };

  /*
   * The Postausgang and its drain in one step: a sign-in mail owed is recorded as the backend would store it, then
   * opened and rendered as `fl_frontend/src/core/mail.ts :: zustellen` does, under the suite's own key, and sent. A case
   * answering `lost` stands for a backend that never answered the enqueue, which then sends nothing.
   */
  const postausgangPostAnmeldung = async (payload: FLPostausgangAnmeldungPayload): Promise<{ acknowledged: 1; id: string }> => {
    const [{ authSecret, frontend_config }, { mailFor }, { renderMail }] = await Promise.all([
      import("@/core/config.ts"),
      import("@/core/mailKinds.ts"),
      import("@/core/emailShell.ts"),
    ]);
    const geheim = payload.geheim === null ? null : await symmetricDecrypt({ key: authSecret(), data: payload.geheim });
    const nachricht = mailFor(payload.daten.art, payload.daten, { token: null, geheim: geheim, origin: frontend_config.AUTH_URL });
    assert(nachricht !== undefined, `no builder renders the sign-in kind ${payload.daten.art}`);
    const mail = { to: payload.an, ...renderMail(nachricht) };

    if ((await answering(mail)) === "lost") {
      throw new APINetworkError({ message: "Request failed.", url: BACKEND, method: "POST", readOnly: false, traceId: "0", isTimeout: false });
    }

    owed.push(payload);
    sent.push(mail);
    return { acknowledged: 1, id: (owed.length - 1).toString(16).padStart(24, "0") };
  };

  // Imported after this call by the suite, so the fan-outs it loads send through the double.
  vi.doMock("@/core/mail.ts", () => doubled);
  vi.doMock("@/core/generated/client/sdk.ts", async () => ({
    ...(await vi.importActual<object>("@/core/generated/client/sdk.ts")),
    postausgangPostAnmeldung: postausgangPostAnmeldung,
  }));
  // Nothing to drain, the stand-in above having sent it: the real call reaches Next's `after`, which a suite holds no scope for.
  vi.doMock("@/core/afterResponse.ts", async () => ({
    ...(await vi.importActual<object>("@/core/afterResponse.ts")),
    drainSoon: () => undefined,
  }));

  // Back to accepted before every case: a case that named a refusal would hand it to the next case's message.
  beforeEach(() => {
    sent.length = 0;
    notices.length = 0;
    owed.length = 0;
    answering = accepted;
  });

  return { sent, notices, owed, answerWith: (next) => void (answering = next) };
}
