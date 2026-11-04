import { NEXT_CACHE_DOUBLE } from "@/test-support/actionDoubles.ts";
import {
  configDouble,
  GATE_BACKEND_CONFIG,
  insertOrderedAdapter,
  memoryStore,
  ORIGIN,
  registerAuthDoubles,
  sessionByCode,
} from "@/test-support/authDoubles.ts";
import { answerAt, NO_RECORDS, SEAT } from "@/test-support/subjectFixtures.ts";
import { assert, beforeEach, describe, expect, it } from "vitest";

import type { MemoryDB } from "better-auth/adapters/memory";

/** What the request a case arrives as carries, which `arriveAs` sets. */
let requestHeaders: Headers | undefined;

const HEADERS_DOUBLE = { headers: () => Promise.resolve(requestHeaders) };

const LOGGING_DOUBLE = { logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } };

const ADAPTER_DOUBLE = {
  mongodbAdapter: () => insertOrderedAdapter(store as unknown as MemoryDB),
};

const mail = registerAuthDoubles({
  core: { logging: LOGGING_DOUBLE, config: configDouble(GATE_BACKEND_CONFIG) },
  specifiers: {
    "next/headers": HEADERS_DOUBLE,
    "next/cache": NEXT_CACHE_DOUBLE,
    "@better-auth/mongo-adapter": ADAPTER_DOUBLE,
  },
});

const store = memoryStore("__flErasureRequestStore");

// Every address the subject read and the gate ask about holds a live seat.
globalThis.fetch = ((input: string | URL | Request) => {
  const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
  return Promise.resolve(Response.json(answerAt(path, { ...NO_RECORDS, seats: [SEAT], account: true })));
}) as typeof globalThis.fetch;

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { requestErasure } = await import("./personActions.ts");
const { auth } = await import("@/core/auth/library.ts");

const HOUR_MS = 60 * 60 * 1000;

beforeEach(() => {
  store.verification.length = 0;
});

/** Answers every guard below as one request would: the cookie they read off `headers()`. */
function arriveAs(cookie: string): void {
  requestHeaders = new Headers({ ...ORIGIN, cookie });
}

// The deletion the link completes is `fl_frontend/src/features/konto/personActions.test.ts`'s.
describe("the account page's request for a deletion link", () => {
  /* Every press mints a token row and mails a link, so the press counts on the address's own mail bound: past
     its fifth, it answers as sent and mints and mails nothing. */
  it("answers every press past the address's fifth link as sent, minting no token row and mailing nothing", async () => {
    const email = "loeschlink-schleife@example.org";
    const { cookie, row } = await sessionByCode(auth, store, email);
    arriveAs(cookie);

    const answers = [];
    for (let press = 0; press < 50; press += 1) answers.push(await requestErasure({}));

    assert.ok(
      answers.every((answer) => answer.ok),
      "a press past the bound answered apart from a sent one",
    );
    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size, "a capped press answers apart from a mailed one").toBe(1);
    expect(mail.sent.filter((sent) => sent.to === email).length, "the address was mailed past its hour's five").toBe(5);
    expect(
      store.verification.filter((held) => held.identifier.startsWith("delete-account-") && held.value === row.userId).length,
      "a capped press minted a token row",
    ).toBe(5);
  });

  /* The link goes to the session's own mailbox, so a session past the step-up window still asks for one. */
  it("mails the link from a session signed in past the step-up window", async () => {
    const { cookie, row } = await sessionByCode(auth, store, "spaeter@example.org");
    row.createdAt = new Date(Date.now() - 3 * HOUR_MS);
    arriveAs(cookie);

    expect((await requestErasure({})).ok).toBe(true);
    assert.ok(
      mail.sent.some((sent) => sent.to === "spaeter@example.org"),
      "no link was mailed",
    );
  });
});
