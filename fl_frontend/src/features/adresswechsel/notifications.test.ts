import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { MongoServerError } from "mongodb";

import {
  configDouble,
  GATE_BACKEND_CONFIG,
  insertOrderedAdapter,
  memoryStore,
  registerAuthDoubles,
  seatEveryAddress,
  sessionByCode,
} from "@/core/authDoubles.ts";

import type { memoryAdapter, MemoryDB } from "better-auth/adapters/memory";

/* The real mailers and the real sign-in store, over the library's in-memory adapter: the transport is the double. */
type LogLine = { level: string; event: string; meta: Record<string, unknown> | undefined };
const logged: LogLine[] = [];
const record =
  (level: string) =>
  (event: string, second?: unknown, third?: unknown): void => {
    const meta = (level === "error" ? third : second) as Record<string, unknown> | undefined;
    logged.push({ level, event, meta });
  };

const store = memoryStore("__flAdresswechselCarryStore");

/**
 * The store's unique email index, which the in-memory adapter has none of: an update moving an account onto an
 * address another account holds is refused with the server's own code, as `user_email_uidx` refuses it.
 */
let storeDown = false;
const uniqueEmailAdapter = (options: Parameters<ReturnType<typeof memoryAdapter>>[0]) => {
  const adapter = insertOrderedAdapter(store as unknown as MemoryDB)(options);
  return {
    ...adapter,
    update: async (args: Parameters<typeof adapter.update>[0]) => {
      if (storeDown) throw new MongoServerError({ message: "not primary", code: 10107 });
      const email = (args.update as { email?: unknown }).email;
      if (args.model === "user" && typeof email === "string" && store.user.some((row) => row.email === email)) {
        throw new MongoServerError({ message: "E11000 duplicate key error", code: 11000, keyPattern: { email: 1 } });
      }
      return adapter.update(args);
    },
  } as typeof adapter;
};

const mail = registerAuthDoubles({
  core: {
    logging: { logger: { debug: record("debug"), info: record("info"), warn: record("warn"), error: record("error") } },
    config: configDouble({ ...GATE_BACKEND_CONFIG, AUTH_URL: "http://localhost:3000" }),
  },
  specifiers: {
    "@better-auth/mongo-adapter": { mongodbAdapter: () => uniqueEmailAdapter },
  },
});
seatEveryAddress();

// Imported here rather than at the top: a static import resolves before the hooks above are registered.
const { adresswechselWirksam, mailAdresswechsel, mailAdresswechselNichtWirksam } = await import("./notifications.ts");
const { auth } = await import("@/core/auth.ts");
const { requestOutcomeUnknown, runWithRequestScope } = await import("@/core/requestScope.ts");

const BISHER = "lena@schule.example";
const NEU = "lena@neu.example";

const mitteilung = (weg: "konto" | "freigabe" | "wartezeit") => ({ bisherige_email: BISHER, email: NEU, vorname: "Lena", weg: weg });

const kontoAn = (email: string) => store.user.find((row) => row.email === email);

beforeEach(() => {
  for (const table of Object.values(store)) (table as unknown[]).length = 0;
  mail.sent.length = 0;
  mail.answerWith(() => "accepted");
  logged.length = 0;
  storeDown = false;
});

describe("a change taking effect, as its caller's server finishes it", () => {
  /* The person who asked for or approved the change keeps their account and its passkeys at the new address. */
  for (const weg of ["konto", "freigabe"] as const) {
    it(`carries the account to the new address on a ${weg} change, ending every session it held, and mails the old address`, async () => {
      const { row } = await sessionByCode(auth, store, BISHER);
      const konto = kontoAn(BISHER);
      store.passkey.push({ id: "passkey-1", userId: konto?.id, credentialID: "cred-1" });

      await adresswechselWirksam({ operation: "test", mitteilung: mitteilung(weg) });

      assert.equal(kontoAn(BISHER), undefined, "the account stayed at the replaced address");
      assert.equal(kontoAn(NEU)?.id, konto?.id, "the new address holds another account than the one carried");
      assert.ok(kontoAn(NEU)?.sessionsEndedAt instanceof Date, "the carried account's sessions were never ended");
      assert.ok(!store.session.some(({ id }) => id === row.id), "a session of the replaced address outlives the carry");
      assert.equal(store.passkey[0]?.userId, konto?.id, "the passkey left the account it was set up on");
      assert.deepEqual(
        mail.sent.map(({ to, subject }) => [to, subject]),
        [[BISHER, "Deine E-Mail-Adresse bei der Frankfurt League wurde geändert"]],
      );
    });
  }

  /* A lost mailbox's holder may be a stranger who signed in there during the waiting time: nothing of theirs follows. */
  it("carries nothing on a change made because the mailbox is lost, and still mails the old address", async () => {
    const { row } = await sessionByCode(auth, store, BISHER);

    await adresswechselWirksam({ operation: "test", mitteilung: mitteilung("wartezeit") });

    assert.ok(kontoAn(BISHER) !== undefined, "the replaced address's account moved with a change it never asked for");
    assert.equal(kontoAn(NEU), undefined);
    assert.ok(
      store.session.some(({ id }) => id === row.id),
      "the replaced address's own session was ended",
    );
    assert.deepEqual(
      mail.sent.map(({ to }) => to),
      [BISHER],
    );
  });

  /* The new address signs in to the account it holds; the old one waits for the account sweep, logged under its own code. */
  it("leaves both accounts where the new address holds one of its own, logging FE-AUTH-013", async () => {
    await sessionByCode(auth, store, BISHER);
    await sessionByCode(auth, store, NEU);
    const [alt, neu] = [kontoAn(BISHER)?.id, kontoAn(NEU)?.id];

    await adresswechselWirksam({ operation: "test", mitteilung: mitteilung("konto") });

    assert.deepEqual([kontoAn(BISHER)?.id, kontoAn(NEU)?.id], [alt, neu]);
    assert.deepEqual(
      logged
        .filter(({ event }) => event === "adresswechsel.konto_nicht_umgezogen")
        .map(({ level, meta }) => [level, meta?.error_code, meta?.grund]),
      [["warn", "FE-AUTH-013", "belegt"]],
    );
    assert.deepEqual(
      mail.sent.map(({ to }) => to),
      [BISHER],
    );
  });

  /* The outbox keeps the row: the next claim moves the account first, and only then tells the old address it moved. */
  it("answers a move the store broke off as not done with, and sends no notice yet", async () => {
    await sessionByCode(auth, store, BISHER);
    storeDown = true;

    const erledigt = await adresswechselWirksam({ operation: "test", mitteilung: mitteilung("konto") });

    assert.equal(erledigt, false);
    assert.deepEqual(mail.sent, []);
    assert.deepEqual(
      logged.filter(({ event }) => event === "adresswechsel.konto_nicht_umgezogen").map(({ level, meta }) => [level, meta?.error_code]),
      [["error", "FE-AUTH-013"]],
    );
  });

  it("answers a sent notice as done with, and a send that never left as not", async () => {
    assert.equal(await adresswechselWirksam({ operation: "test", mitteilung: mitteilung("wartezeit") }), true);
    mail.answerWith(() => "unsent");
    assert.equal(await adresswechselWirksam({ operation: "test", mitteilung: mitteilung("wartezeit") }), false);
  });

  it("carries nothing where the replaced address never had an account, and logs nothing", async () => {
    await adresswechselWirksam({ operation: "test", mitteilung: mitteilung("konto") });

    assert.deepEqual(store.user, []);
    assert.deepEqual(
      logged.filter(({ event }) => event.startsWith("adresswechsel.")),
      [],
    );
    assert.deepEqual(
      mail.sent.map(({ to }) => to),
      [BISHER],
    );
  });
});

describe("the notice of a due change the pass refused", () => {
  /* Through the ban list like every message: a refusal caused by a ban on this very address mails nothing there. */
  it("mails the new address a nameless notice, and a barred one nothing", async () => {
    const gesendet = await mailAdresswechselNichtWirksam({ operation: "test", email: NEU });
    mail.answerWith(() => "barred");
    const gesperrt = await mailAdresswechselNichtWirksam({ operation: "test", email: NEU });

    assert.deepEqual(mail.sent.map(({ to, subject }) => [to, subject]).slice(0, 1), [
      [NEU, "Deine E-Mail-Adresse bei der Frankfurt League wurde nicht geändert"],
    ]);
    // Both done with: a barred address is never mailed, however often the outbox claims its row.
    assert.deepEqual([gesendet, gesperrt], [true, true]);
  });

  it("answers a failed send as not done with, so the outbox keeps the row", async () => {
    mail.answerWith(() => "unsent");

    assert.equal(await mailAdresswechselNichtWirksam({ operation: "test", email: NEU }), false);
  });
});

describe("a change's two messages", () => {
  const MINT = {
    id: "68c1f0a2b3c4d5e6f7a8b9e0",
    weg: "wartezeit" as const,
    token: "neu-token",
    stopp_token: "stopp-token",
    gueltig_bis: "2026-10-21T11:30:00Z",
    email: NEU,
    bisherige_email: BISHER,
    vorname: "Lena",
  };

  /* One record per address: the link's delivery is filed under the change itself, never under a carrier row. */
  it("files the link's delivery under the change's own id, and sends the notice untagged", async () => {
    await mailAdresswechsel({ operation: "test", mint: MINT, anlass: "empfang" });

    assert.deepEqual(mail.sent.find(({ to }) => to === NEU)?.tags, { ziel: "adresswechsel", ziel_id: MINT.id, anlass: "empfang" });
    assert.equal(mail.sent.find(({ to }) => to === BISHER)?.tags, undefined);
  });

  it("mails the address on file nothing on a re-send, whose stop link is already there", async () => {
    await mailAdresswechsel({ operation: "test", mint: { ...MINT, stopp_token: null }, anlass: "erneut" });

    assert.deepEqual(
      mail.sent.map(({ to }) => to),
      [NEU],
    );
  });
});

/* The notice to the address in force is sent alone, beside the fan-out, and ends in the fan-out's own words. */
describe("the notice a change sends the address in force", () => {
  const sendeWechsel = () =>
    mailAdresswechsel({
      operation: "POST /adresswechsel",
      mint: {
        id: "68c1f0a2b3c4d5e6f7a8b9e0",
        weg: "konto",
        token: "neu-token",
        stopp_token: "stopp-token",
        gueltig_bis: "2026-10-05T10:00:00Z",
        email: NEU,
        bisherige_email: BISHER,
        vorname: "Lena",
      },
      anlass: "empfang",
    });

  /* It may have landed, and it is a courtesy beside a saved write: its own answer says so, and the request's outcome
     stays the write's and the link's (`docs/frontend/spec.md :: I372`). */
  it("ends as unclear where its send broke off unanswered, leaving the request's outcome unmarked", async () => {
    mail.answerWith(({ to }) => (to === BISHER ? "lost" : { accepted: "56761188-7520-42d8-8898-ff6fc54ce618" }));

    const [versand, markedUnknown] = await runWithRequestScope({ traceId: "a".repeat(32), spanId: "b".repeat(16) }, async () => {
      const ended = await sendeWechsel();
      return [ended, requestOutcomeUnknown()] as const;
    });

    assert.deepEqual(versand, { weg: "konto", link: "gesendet", hinweis: "ungewiss" });
    assert.equal(markedUnknown, false, "a notice that may have landed answered the whole request as of unknown outcome");
  });

  for (const [outcome, hinweis] of [
    ["barred", "gesperrt"],
    ["withheld", "zurueckgehalten"],
  ] as const) {
    it(`ends as ${hinweis} where the mailer answered ${outcome}`, async () => {
      mail.answerWith(({ to }) => (to === BISHER ? outcome : { accepted: "56761188-7520-42d8-8898-ff6fc54ce618" }));

      assert.equal((await sendeWechsel()).hinweis, hinweis);
    });
  }
});
