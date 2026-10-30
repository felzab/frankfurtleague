import { symmetricDecrypt } from "better-auth/crypto";
import { assert, beforeEach, vi } from "vitest";

import { APINetworkError } from "@/core/errors.ts";

import type { MailVon } from "@/core/emailShell.ts";
import type { FLPostausgangAnmeldungPayload } from "@/core/generated/client/types.ts";

/** One sign-in mail the double sent, rendered as the drain renders it. */
export type SentMail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  von: MailVon;
};

/** How the double answers one owed sign-in mail: sent, or `lost`, a backend that never answered the enqueue. */
type MailAnswer = (mail: SentMail) => "accepted" | "lost" | Promise<"accepted" | "lost">;

const BACKEND = "https://backend.invalid/api/v0/postausgang/anmeldung";

/**
 * Stands in for the Postausgang and its drain in one step: a sign-in mail owed is recorded as the backend would store it,
 * then opened and rendered as `fl_frontend/src/core/mail.ts :: zustellen` does, under the suite's own key, and sent; every
 * other mail is owed by the backend's own write and drained by nothing here.
 */
export function doublePostausgang(): {
  sent: SentMail[];
  owed: FLPostausgangAnmeldungPayload[];
  answerWith: (next: MailAnswer) => void;
} {
  const sent: SentMail[] = [];
  // Every sign-in mail owed through the Postausgang, as the backend was handed it.
  const owed: FLPostausgangAnmeldungPayload[] = [];
  const accepted: MailAnswer = () => "accepted";
  let answering = accepted;

  const postausgangPostAnmeldung = async (payload: FLPostausgangAnmeldungPayload): Promise<void> => {
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
  };

  // Imported after this call by the suite, so the modules it loads owe through the double.
  vi.doMock("@/core/generated/client/sdk.ts", async () => ({
    ...(await vi.importActual<object>("@/core/generated/client/sdk.ts")),
    postausgangPostAnmeldung: postausgangPostAnmeldung,
  }));

  // Back to accepted before every case: a case that named `lost` would hand it to the next case's mail.
  beforeEach(() => {
    sent.length = 0;
    owed.length = 0;
    answering = accepted;
  });

  return { sent, owed, answerWith: (next) => void (answering = next) };
}
