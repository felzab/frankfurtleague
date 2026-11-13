import { randomBytes } from "node:crypto";

import { configDouble } from "@/test-support/authDoubles.ts";
import { networkFailure, serveBackend } from "@/test-support/backend.ts";
import { doubleNextRequest } from "@/test-support/nextRequest.ts";
import { captureLog } from "@/test-support/stdoutCapture.ts";
import { assert, describe, it, vi } from "vitest";

// Under the production build's `NODE_ENV` (`fl_frontend/vitest.config.mts :: PRODUCTION_BUILD`): only its format writes
// every value a line is handed, an `error` that is no `Error` among them, which a line naming no recipient is held to.

/** Its own throwaway, minted per run: this file signs the events it verifies. */
const webhookSecret = `whsec_${randomBytes(24).toString("base64")}`;

/** Every line the real logger writes, read off standard output. */
const log = captureLog();

// The Postausgang's event endpoint alone, never reached: the backend fails every event this file forwards.
serveBackend(({ method, path }) => (method === "POST" && path === "/outbox/event" ? networkFailure() : undefined));
vi.doMock("@/core/config.ts", () => configDouble({}, { resendWebhookSecret: () => webhookSecret }));
doubleNextRequest();

const { POST } = await import("./route.ts");
const { NextRequest } = await import("next/server");
const { Webhook } = await import("svix");

const ROW_ID = `${"b".repeat(23)}2`;
const ADDRESS = "erika@schule.de";

/** One event about the row, sent to `ADDRESS`. */
const eventFor = (type: string, data: Record<string, unknown> = {}): Record<string, unknown> => ({
  type,
  created_at: "2026-09-08T10:15:00.000Z",
  data: {
    email_id: "56761188-7520-42d8-8898-ff6fc54ce618",
    created_at: "2026-09-08T10:14:59.000Z",
    to: [ADDRESS],
    subject: "Bitte bestätige Deine Angaben",
    tags: { outbox_id: ROW_ID },
    ...data,
  },
});

/** One request as the provider sends it, signed over its bytes unless `signature` names another. */
function signed(payload: string, signature?: string) {
  const stamp = new Date();
  const id = "msg_2xyzABC";

  return new NextRequest("http://localhost/api/mail/delivery", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(stamp.getTime() / 1000)),
      "svix-signature": signature ?? new Webhook(webhookSecret).sign(id, stamp, payload),
    },
    body: payload,
  });
}

describe("POST /api/mail/delivery's lines", () => {
  /* The tag block carries the row's id and the body the recipient. Asserted over the whole document, so a field added
     later, or the event handed to the logger as its error, cannot reopen it. */
  it("names no recipient on any line it writes", async () => {
    await POST(signed(JSON.stringify(eventFor("email.bounced", { bounce: { type: "Permanent" } }))));
    await POST(signed(JSON.stringify(eventFor("email.delivered")), "v1,nope"));

    const lines = log.lines();
    assert.ok(lines.length >= 2, `expected a line for each of the two failures, saw ${String(lines.length)}`);
    // The logger scrubs an address it meets, so a line carrying one reads as its placeholder.
    for (const { raw } of lines) {
      assert.ok(!raw.includes(ADDRESS) && !raw.includes("[address]"), `an address reached the stream: ${raw}`);
    }
  });
});
