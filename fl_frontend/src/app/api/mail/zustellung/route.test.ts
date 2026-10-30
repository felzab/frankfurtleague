import { randomBytes } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FLPostausgangEreignisPayload } from "@/core/generated/client/types.ts";

/** Its own throwaway, minted per run: this file signs the events it verifies. */
const webhookSecret = `whsec_${randomBytes(24).toString("base64")}`;

/** Every write the route asked for, by the endpoint it went to. */
const forwarded: { endpoint: string; payload: unknown }[] = [];

const recording = (endpoint: string, answer: unknown) => async (payload: unknown) => {
  forwarded.push({ endpoint, payload });
  return answer;
};

vi.doMock("@/core/config.ts", () => ({ resendWebhookSecret: () => webhookSecret }));
vi.doMock("@/core/logging.ts", () => ({ logger: { info: () => undefined, warn: () => undefined, error: () => undefined } }));
// `next/headers` is request-only and throws outside one, so the real scope cannot run here.
vi.doMock("@/shared/utils/traceScope.ts", () => ({ runWithIncomingTrace: async (fn: () => unknown) => fn() }));
vi.doMock("@/core/generated/client/sdk.ts", () => ({
  postausgangPostEreignis: recording("postausgang", { acknowledged: 1, angewendet: true }),
}));
vi.doMock("@/features/bewerbungen/mutations.ts", () => ({ meldeZustellEreignis: recording("bewerbung", { acknowledged: 1, angewendet: [] }) }));
vi.doMock("@/features/zustellung/mutations.ts", () => ({ meldeZielZustellEreignis: recording("ziel", { acknowledged: 1, angewendet: true }) }));

const { POST } = await import("./route.ts");
const { NextRequest } = await import("next/server");
const { Webhook } = await import("svix");

const ROW_ID = `${"b".repeat(23)}2`;
const EVENT_AT = "2026-09-08T10:15:00.000Z";

/** One signed request, as the provider sends it: the signature is over the bytes in the body. */
function signed(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const stamp = new Date();
  const id = "msg_2xyzABC";

  return new NextRequest("http://localhost/api/mail/zustellung", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(stamp.getTime() / 1000)),
      "svix-signature": new Webhook(webhookSecret).sign(id, stamp, payload),
    },
    body: payload,
  });
}

beforeEach(() => {
  forwarded.length = 0;
});

describe("POST /api/mail/zustellung for a mail from the Postausgang", () => {
  /* The row is found by the id its send was tagged with: read by anything else, the event reaches no row, and the
     provider is answered 200 all the same, which no one sees. The application's own tags ride beside it and lose. */
  it("hands the event to the Postausgang by the row's tag, and to no other route", async () => {
    const res = await POST(
      signed({
        type: "email.bounced",
        created_at: EVENT_AT,
        data: {
          email_id: "56761188-7520-42d8-8898-ff6fc54ce618",
          tags: { postausgang_id: ROW_ID, bewerbung_id: `${"a".repeat(23)}1`, rollen: "ansprechperson" },
          bounce: { type: "Permanent", subType: "Suppressed" },
        },
      }),
    );

    const expected: FLPostausgangEreignisPayload = { id: ROW_ID, stand: "unzustellbar", grund: "Suppressed", am: EVENT_AT };
    expect(res.status).toBe(200);
    expect(forwarded).toStrictEqual([{ endpoint: "postausgang", payload: expected }]);
  });
});
