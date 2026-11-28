// @vitest-environment jsdom
import { assert, describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";
import { serveHost } from "@/test-support/backend";

import { clientRefusal, describeCeremonyRefusal, describeSetUpRefusal } from "./passkeyAnswers";
import { codeRefusal } from "./signInAnswers";

import type { Copy } from "@/core/copy";
import type { ClientRefusal } from "./passkeyAnswers";

// The edge's own answer past the sign-in's zone: plain text, so the client parses no body and keeps the status alone.
const taken = serveHost(
  window.location.origin,
  () => new Response("Zu viele Versuche.", { status: 429, headers: { "content-type": "text/plain" } }),
);

type Ceremony = {
  ceremony: string;
  call: Parameters<typeof clientRefusal>[0];
  word: (refusal: ClientRefusal) => Copy | null;
};

const CEREMONIES: readonly Ceremony[] = [
  { ceremony: "a passkey sign-in", call: (client) => client.signIn.passkey(), word: describeCeremonyRefusal },
  { ceremony: "a passkey set-up", call: (client) => client.passkey.addPasskey(), word: describeSetUpRefusal },
  {
    ceremony: "a code check",
    call: (client) => client.signIn.emailOtp({ email: "anna@example.com", otp: "123456" }),
    word: codeRefusal,
  },
];

// The harm: a person meeting the edge's limit reads a fault, or a missing passkey, where every limit on tries reads
// one line; the client keeping the status on a body it cannot parse is the library's, which a bump could change.
describe("the edge's limit on the sign-in's requests", () => {
  it.each(CEREMONIES)("reads too many tries on $ceremony", async ({ call, word }) => {
    const refusal = await clientRefusal(call);

    assert.ok(refusal !== null, "the edge's refusal reached the client as one");
    expect(taken.length, "the call reached the edge once").toBe(1);
    expect(word(refusal)).toBe(COPY.shared.failure.tooManyAttempts);
  });
});
