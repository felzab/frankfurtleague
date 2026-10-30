import { randomBytes } from "node:crypto";
import { inspect } from "node:util";

import { assert, beforeEach, describe, expect, it, vi } from "vitest";

import type { Code, FLPostausgangEreignisPayload } from "@/core/generated/client/types.ts";

/** Its own throwaway, minted per run: this file signs the events it verifies. */
const webhookSecret = `whsec_${randomBytes(24).toString("base64")}`;

// Read by the route on every event, so a case can take the key away and put it back.
let heldSecret: string | undefined = webhookSecret;

type LoggedLine = { level: string; message: string; meta?: Record<string, unknown> };

const logs: LoggedLine[] = [];

/** Every event the route handed the Postausgang. */
const forwarded: FLPostausgangEreignisPayload[] = [];

/** What the backend answers a forwarded event, or throws for it; a case names another for itself. */
let answer: () => unknown = () => ({ angewendet: true });

vi.doMock("@/core/config.ts", () => ({ resendWebhookSecret: () => heldSecret }));
vi.doMock("@/core/logging.ts", () => ({
  logger: {
    info: (message: string, meta?: Record<string, unknown>) => void logs.push({ level: "info", message, meta }),
    warn: (message: string, meta?: Record<string, unknown>) => void logs.push({ level: "warn", message, meta }),
    error: (message: string, _error: unknown, meta?: Record<string, unknown>) => void logs.push({ level: "error", message, meta }),
  },
}));
// `next/headers` is request-only and throws outside one, so the real scope cannot run here.
vi.doMock("@/shared/utils/traceScope.ts", () => ({ runWithIncomingTrace: async (fn: () => unknown) => fn() }));
vi.doMock("@/core/generated/client/sdk.ts", () => ({
  postausgangPostEreignis: async (payload: FLPostausgangEreignisPayload) => {
    forwarded.push(payload);
    return answer();
  },
}));

const { POST } = await import("./route.ts");
const { APIBadStatusError, APINetworkError } = await import("@/core/errors.ts");
const { NextRequest } = await import("next/server");
const { Webhook } = await import("svix");

const ROW_ID = `${"b".repeat(23)}2`;
const ADDRESS = "erika@schule.de";

/** The envelope's own instant, which orders events; `data.created_at` is the message's and repeats. */
const EVENT_AT = "2026-09-08T10:15:00.000Z";
const MESSAGE_AT = "2026-09-08T10:14:59.000Z";

function eventFor(type: string, data: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: type,
    created_at: EVENT_AT,
    data: {
      email_id: "56761188-7520-42d8-8898-ff6fc54ce618",
      created_at: MESSAGE_AT,
      to: [ADDRESS],
      subject: "Bitte bestätige Deine Angaben",
      tags: { postausgang_id: ROW_ID },
      ...data,
    },
  };
}

/** One signed request, as the provider sends it: the signature is over the bytes in the body. */
function signed(payload: string, { alter = 0, headers = {} }: { alter?: number; headers?: Record<string, string> } = {}) {
  const stamp = new Date(Date.now() - alter);
  const id = "msg_2xyzABC";

  return new NextRequest("http://localhost/api/mail/zustellung", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(stamp.getTime() / 1000)),
      "svix-signature": new Webhook(webhookSecret).sign(id, stamp, payload),
      ...headers,
    },
    body: payload,
  });
}

async function statusFor(event: Record<string, unknown>): Promise<number> {
  return (await POST(signed(JSON.stringify(event)))).status;
}

/** The state and reason the route forwarded for one event, or `undefined` where it forwarded nothing. */
async function forwardedFor(event: Record<string, unknown>): Promise<Pick<FLPostausgangEreignisPayload, "stand" | "grund"> | undefined> {
  forwarded.length = 0;
  await statusFor(event);
  const [payload] = forwarded;
  return payload === undefined ? undefined : { stand: payload.stand, grund: payload.grund };
}

const NETWORK_FAILURE = () =>
  new APINetworkError({
    message: "Request failed.",
    url: "http://backend:8000",
    method: "POST",
    readOnly: false,
    traceId: "t".repeat(32),
    isTimeout: false,
  });

beforeEach(() => {
  logs.length = 0;
  forwarded.length = 0;
  answer = () => ({ angewendet: true });
});

describe("what one delivery event leaves on its Postausgang row", () => {
  /* The row is found by the id its send was tagged with: read by anything else, the event reaches no row, and the
     provider is answered 200 all the same, which no one sees. Other tags ride beside it and lose. */
  it("hands the event to the Postausgang by the row's tag, at the envelope's instant", async () => {
    const res = await POST(
      signed(
        JSON.stringify(
          eventFor("email.bounced", {
            tags: { postausgang_id: ROW_ID, bewerbung_id: `${"a".repeat(23)}1`, rollen: "ansprechperson" },
            bounce: { type: "Permanent", subType: "Suppressed" },
          }),
        ),
      ),
    );

    const expected: FLPostausgangEreignisPayload = { id: ROW_ID, stand: "unzustellbar", grund: "Suppressed", am: EVENT_AT };
    expect(res.status).toBe(200);
    expect(forwarded).toStrictEqual([expected]);
  });

  /* Each pair is the provider's own event name against this side's stored word. A full mailbox and a greylisting server
     both bounce Temporary, and a failed send is the league's own daily quota: neither says the address refuses. */
  it("reads every subscribed event as the state it leaves, a temporary bounce and a failed send as delayed", async () => {
    const readBack = [];
    for (const [type, data] of [
      ["email.delivered", {}],
      ["email.bounced", { bounce: { type: "Permanent", subType: "Suppressed" } }],
      ["email.bounced", { bounce: { type: "Temporary", subType: "MailboxFull" } }],
      ["email.suppressed", { suppressed: { type: "OnAccountSuppressionList" } }],
      ["email.complained", {}],
      ["email.delivery_delayed", {}],
      ["email.failed", { failed: { reason: "reached_daily_quota" } }],
    ] as const) {
      readBack.push(await forwardedFor(eventFor(type, data)));
    }

    expect(readBack).toStrictEqual([
      { stand: "zugestellt", grund: null },
      { stand: "unzustellbar", grund: "Suppressed" },
      { stand: "verzoegert", grund: "MailboxFull" },
      { stand: "unterdrueckt", grund: "OnAccountSuppressionList" },
      { stand: "beschwerde", grund: null },
      { stand: "verzoegert", grund: null },
      { stand: "verzoegert", grund: "reached_daily_quota" },
    ]);
  });

  /* The endpoint bounds the reason and holds it to one line, and its 422 would be answered 200: a reason passed on as
     the provider wrote it would be a bounce recorded nowhere. */
  it("keeps the state and drops a reason the endpoint would refuse, never the provider's prose", async () => {
    expect(await forwardedFor(eventFor("email.failed", { failed: { reason: "Q".repeat(129) } }))).toStrictEqual({
      stand: "verzoegert",
      grund: null,
    });
    expect(await forwardedFor(eventFor("email.failed", { failed: { reason: "quota\nexceeded" } }))).toStrictEqual({
      stand: "verzoegert",
      grund: null,
    });

    await forwardedFor(
      eventFor("email.bounced", { bounce: { type: "Permanent", subType: "Suppressed", message: `No mailbox for ${ADDRESS}` } }),
    );
    assert.ok(!inspect(forwarded, { depth: null }).includes(ADDRESS), "the recipient reached the write");
  });

  it("answers 200 and forwards nothing for an event that leaves no state or names no row", async () => {
    for (const event of [
      eventFor("email.sent"),
      eventFor("email.opened"),
      eventFor("email.delivered", { tags: undefined }),
      // A mail sent before the Postausgang carries the old path's tags alone.
      eventFor("email.delivered", { tags: { bewerbung_id: `${"a".repeat(23)}1`, rollen: "trainer" } }),
    ]) {
      expect(await statusFor(event)).toBe(200);
    }

    expect(forwarded).toStrictEqual([]);
  });
});

describe("POST /api/mail/zustellung's signature", () => {
  /* 400 and not 503: a forgery is not worth the provider's thirty-two hours of retries, and the schedule ends with the
     endpoint disabled for every real event too. */
  it("answers 400 for a body changed after it was signed", async () => {
    const genuine = JSON.stringify(eventFor("email.delivered"));
    const request = signed(genuine);

    const res = await POST(
      new NextRequest("http://localhost/api/mail/zustellung", {
        method: "POST",
        headers: request.headers,
        body: genuine.replace(ROW_ID, `${"c".repeat(23)}3`),
      }),
    );

    expect(res.status).toBe(400);
    expect(forwarded).toStrictEqual([]);
  });

  /* The signature is over the bytes the provider sent: parsed first and re-serialised, a body written with other
     whitespace verifies as a forgery, and a forged one is parsed before it is refused. */
  it("verifies the bytes it was sent, and parses none it has not verified", async () => {
    const spaced = await POST(signed(JSON.stringify(eventFor("email.delivered"), null, 2)));
    const request = signed(JSON.stringify(eventFor("email.delivered")));
    const unreadable = await POST(
      new NextRequest("http://localhost/api/mail/zustellung", { method: "POST", headers: request.headers, body: "{ kein json" }),
    );

    expect(spaced.status, "a genuine event written with other whitespace is refused as a forgery").toBe(200);
    expect(unreadable.status, "an unverified body is parsed before it is refused").toBe(400);
  });

  it("answers 400 for a signature that is not this secret's, or with any one signing header missing", async () => {
    const body = JSON.stringify(eventFor("email.delivered"));
    const foreign = new Webhook(`whsec_${randomBytes(24).toString("base64")}`).sign("msg_2xyzABC", new Date(), body);

    expect((await POST(signed(body, { headers: { "svix-signature": foreign } }))).status).toBe(400);
    for (const missingField of ["svix-id", "svix-timestamp", "svix-signature"]) {
      expect((await POST(signed(body, { headers: { [missingField]: "" } }))).status, `a request without ${missingField} was accepted`).toBe(
        400,
      );
    }

    expect(forwarded).toStrictEqual([]);
  });

  /* A deployment other than production holds no key, the provider sending it nothing: a signed event reaching one is
     refused unverified rather than applied. */
  it("answers 400 and forwards nothing where the deployment holds no webhook key", async () => {
    const request = signed(JSON.stringify(eventFor("email.delivered")));
    heldSecret = undefined;
    try {
      expect((await POST(request)).status).toBe(400);
    } finally {
      heldSecret = webhookSecret;
    }

    expect(forwarded).toStrictEqual([]);
    expect(logs.map(({ message }) => message)).toStrictEqual(["mail.zustellung_unsigniert"]);
  });

  /* The verifier's own tolerance is five minutes either way, read from the installed `standardwebhooks` module's
     `WEBHOOK_TOLERANCE_IN_SECONDS` and stated by no vendor page. A replay of a captured request stops working after it. */
  it("answers 400 for a signature older than the verifier's tolerance", async () => {
    const body = JSON.stringify(eventFor("email.delivered"));

    expect((await POST(signed(body, { alter: 4 * 60 * 1000 }))).status, "a signature inside the tolerance was refused").toBe(200);
    expect((await POST(signed(body, { alter: 6 * 60 * 1000 }))).status).toBe(400);
  });
});

describe("POST /api/mail/zustellung where the backend does not take the event", () => {
  /* The endpoint answers a row gone or an event already answered with `angewendet: false`, so a failure is a route the
     API does not serve mid-deploy, a credential or a body it does not take, a server error or a network failure: settled,
     each would lose the event, where the provider's retry lands later. */
  it("has every failure sent again, and writes one line", async () => {
    const answered = async (failure: Error) => {
      answer = () => {
        throw failure;
      };
      return statusFor(eventFor("email.delivered"));
    };
    const badStatus = (statusCode: number, serverErrorCode: Code | undefined) =>
      new APIBadStatusError({
        message: "API returned a bad status.",
        url: "http://backend:8000",
        statusCode,
        serverErrorCode,
        endpoint: "/postausgang/ereignis",
        method: "POST",
        readOnly: false,
        traceId: "t".repeat(32),
      });

    for (const [statusCode, code] of [
      [404, "no_route"],
      [405, "method_not_served"],
      [404, undefined],
      [401, "access_key_refused"],
      [422, "payload_refused"],
      [500, undefined],
    ] as const) {
      expect(await answered(badStatus(statusCode, code)), `${String(code)} at ${String(statusCode)} settled the event`).toBe(503);
    }
    expect(await answered(NETWORK_FAILURE())).toBe(503);
    expect(new Set(logs.map(({ level, message }) => `${level} ${message}`))).toStrictEqual(new Set(["error mail.zustellung_ungeschrieben"]));
  });

  /* The tag block carries the row's id and the body the recipient. Asserted over the whole line, so a field added later
     cannot reopen it. */
  it("names no recipient on any line it writes", async () => {
    answer = () => {
      throw NETWORK_FAILURE();
    };

    await statusFor(eventFor("email.bounced", { bounce: { type: "Permanent" } }));
    await POST(signed(JSON.stringify(eventFor("email.delivered")), { headers: { "svix-signature": "v1,nope" } }));

    assert.ok(logs.length >= 2, `expected a line for each of the two failures, saw ${String(logs.length)}`);
    assert.ok(!inspect(logs, { depth: null }).includes(ADDRESS), "an address reached the stream");
  });
});
