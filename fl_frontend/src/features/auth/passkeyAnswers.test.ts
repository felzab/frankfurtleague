import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { describeSetUpRefusal } from "./passkeyAnswers";

/* A refusal a retry meets again, worded as the shared failure line, sends the person into a loop of presses the same
   refusal answers: each the plugin's client names by its code is worded by what repairs it. */
describe("why Sicherheit's set-up of a further passkey did not happen", () => {
  it.each([
    ["the library's freshness refusal", { code: "SESSION_NOT_FRESH", status: 403 }, COPY.account.passkeys.signInTooOld],
    [
      "an authenticator already holding one of the person's passkeys",
      { code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED", status: 400 },
      COPY.account.passkeys.alreadyOnDevice,
    ],
    ["a cancelled prompt", { code: "ERROR_CEREMONY_ABORTED", status: 400 }, COPY.shared.failure.unexpected],
    ["an answer naming no code", { status: 500 }, COPY.shared.failure.unexpected],
  ])("words %s by its code", (_, error, line) => {
    expect(describeSetUpRefusal(error)).toBe(line);
  });
});
