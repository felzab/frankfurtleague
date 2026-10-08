import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after } from "node:test";

import { memoryAdapter } from "better-auth/adapters/memory";
import { ObjectId } from "mongodb";

import { registerDoubles } from "./exportingModule.ts";
import { doubleSendMail } from "./mailDouble.ts";
import { answerAt, deepFrozen, NO_RECORDS, SITZ } from "./subjectFixtures.ts";

import type { MemoryDB } from "better-auth/adapters/memory";
import type { auth as AuthInstance } from "./auth.ts";
import type { DoubledExports } from "./exportingModule.ts";
import type { LookupFixture } from "./subjectFixtures.ts";

export { asDataUrl } from "./exportingModule.ts";

export const ADMIN_EMAIL = "vorstand@example.org";

/**
 * The pair the actor is signed with wherever a suite boots or runs a guard, made for the run: a key
 * file kept in the tree would be a signing key anybody could read.
 */
export const ACTOR_KEY_PAIR = generateKeyPairSync("ed25519");

const ACTOR_KEY_DIRECTORY = mkdtempSync(path.join(tmpdir(), "fl-actor-key-"));
/** `ACTOR_KEY_PAIR`'s private half, as the compose secret holds one: "PKCS#8" PEM. */
export const ACTOR_KEY_FILE = path.join(ACTOR_KEY_DIRECTORY, "signing-key.pem");
writeFileSync(ACTOR_KEY_FILE, ACTOR_KEY_PAIR.privateKey.export({ type: "pkcs8", format: "pem" }));
after(() => rmSync(ACTOR_KEY_DIRECTORY, { recursive: true, force: true }));

/** What a request arriving at the served origin carries, matched to the config double's `AUTH_URL`. */
export const ORIGIN = { host: "localhost:3000", "x-forwarded-proto": "http" } as const;

/** A secret's reader in `fl_frontend/src/core/config.ts`, by its exported name, as a double answers it. */
type SecretReaders = Readonly<Record<string, () => string | undefined>>;

const SECRET_DOUBLES: SecretReaders = {
  // Reaches the library as its `secret` option, which it reads ahead of `BETTER_AUTH_SECRET` and
  // `AUTH_SECRET`, so neither environment name needs setting for a run.
  authSecret: () => "fabricated-test-secret-not-a-credential",
  // The key the sign-in gate's one backend read is made with.
  internalApiKeySystem: () => "fabricated-system-not-a-credential",
};

/** The config every sign-in suite runs `fl_frontend/src/core/auth.ts` under, `secrets` over the readers' defaults. */
export function configDouble(overrides: Readonly<Record<string, unknown>> = {}, secrets: SecretReaders = {}): DoubledExports {
  const config = {
    ...GATE_BACKEND_CONFIG,
    AUTH_URL: `http://${ORIGIN.host}`,
    ACTOR_SIGNING_KEY_FILE: ACTOR_KEY_FILE,
    LOG_LEVEL: "ERROR",
    LOG_FORMAT: "json",
    ...overrides,
  };
  // An override of `undefined` takes the name out, as an unset variable is absent from the real config.
  const frontend_config = Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined));
  return { frontend_config, ...SECRET_DOUBLES, ...secrets };
}

/* Replaced here rather than the adapter being given a seam: the real client needs a `MONGODB_URI`
   the config above omits, and with one a suite left on the real adapter would reach for a server
   rather than fail at once. */
const DB_DOUBLE: DoubledExports = { signInStore: () => ({ db: () => ({}) }) };

/** What the library hands an adapter factory as it builds the adapter. */
type AdapterOptions = Parameters<ReturnType<typeof memoryAdapter>>[0];

/**
 * The library's in-memory adapter over `store`, minting ids as the Mongo adapter does rather than at
 * random: an `ObjectId` rising with each insert, which settles two sessions stamped in one millisecond
 * (`fl_frontend/src/core/auth.ts :: mintedBefore`).
 */
export const insertOrderedAdapter =
  (store: MemoryDB) =>
  (options: AdapterOptions): ReturnType<ReturnType<typeof memoryAdapter>> =>
    memoryAdapter(store)({
      ...options,
      advanced: { ...options.advanced, database: { ...options.advanced?.database, generateId: () => new ObjectId().toHexString() } },
    });

/**
 * The Mongo adapter reaches a real server through aggregation pipelines, so the store under the real
 * `auth.ts` is the library's own in-memory one, over the object held at `globalThis[store]`.
 */
export const memoryAdapterDouble = (store: string): DoubledExports => ({
  mongodbAdapter: () => insertOrderedAdapter(Reflect.get(globalThis, store) as MemoryDB),
});

type AuthDoubles = {
  /**
   * By the `fl_frontend/src/core/<name>.ts` each replaces, over the two defaults. A source is taken
   * only as `overridingModule` builds one: a hand-listed one fails to link the day auth.ts imports one more name.
   */
  readonly core?: Readonly<Record<string, DoubledExports | string>>;
  /** By the bare specifier each replaces: the package's doubled exports, or the URL of a module loaded in its place. */
  readonly specifiers?: Readonly<Record<string, DoubledExports | string>>;
};

/**
 * `registerDoubles` under the config, the store client and the mailer `fl_frontend/src/core/auth.ts`
 * builds on, and the lookup its grant is read over. Test-only, which `no-restricted-imports` in
 * `fl_frontend/eslint.config.mjs` holds it to.
 */
export function registerAuthDoubles({ core = {}, specifiers = {} }: AuthDoubles = {}): ReturnType<typeof doubleSendMail> {
  // The mailer is always `doubleSendMail`'s, whose record this answers. A second one is refused rather
  // than layered: two mailer hooks answer by registration order, and a suite would read whichever came last.
  if ("mail" in core) throw new Error("The mailer is doubleSendMail's: read the record registerAuthDoubles answers.");
  const modules = Object.entries({ config: configDouble(), db: DB_DOUBLE, ...core }).map(([name, double]) => [`core/${name}.ts`, double]);

  // The grant is read over the lookup, so without an answer no suite has an administrator at all. A
  // suite answering the lookup itself, before this or after it, keeps its own answer.
  if (!lookupAnswered) answerTheLookup((email) => (email === ADMIN_EMAIL ? GRANTED : null));

  registerDoubles({
    modules: Object.fromEntries(modules),
    specifiers: Object.fromEntries(
      Object.entries(specifiers).map(([specifier, double]) => [specifier, typeof double === "string" ? new URL(double) : double]),
    ),
  });

  return doubleSendMail();
}

/** How long a held write or read waits for the requests racing it, in both db-tier suites. */
export const BARRIER_TIMEOUT_MS = 5000;

/** Holds the first `expected` writes until all have arrived; every write after them passes. */
export class Barrier {
  private expected = 0;
  private arrived = 0;
  private waiters: (() => void)[] = [];
  private fill: (filled: boolean) => void = () => undefined;

  /**
   * Whether every write `arm` expected arrived before any was released. A case asserts it before
   * judging what the requests answered: one that skipped the held write ran no race.
   */
  filled: Promise<boolean> = Promise.resolve(false);

  arm(expected: number): void {
    this.expected = expected;
    this.arrived = 0;
    this.waiters = [];
    this.filled = new Promise((resolve) => {
      this.fill = resolve;
    });
  }

  disarm(): void {
    this.expected = 0;
    for (const release of this.waiters) release();
    this.waiters = [];
    this.fill(false);
  }

  async arrive(): Promise<void> {
    if (this.expected === 0 || this.arrived >= this.expected) return;
    this.arrived += 1;
    if (this.arrived === this.expected) {
      this.fill(true);
      this.disarm();
      return;
    }

    // Bounded, so a request that never reaches a held write ends the hold rather than hanging the
    // run. Taken now: the timer outlives this arming, and must not answer the next one's.
    const fill = this.fill;
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      setTimeout(() => {
        fill(false);
        resolve();
      }, BARRIER_TIMEOUT_MS);
    });
  }
}

/** The `Cookie` header a browser would send back after this response. */
export const cookieHeader = (response: { headers: Headers }): string =>
  response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");

/**
 * A session minted the way a typed code mints one, off the plugin's own server-only mint, which
 * passes no gate and sends nothing: it serves an address the send mails nothing, and never meets
 * the mail cap.
 */
export async function signInByCode(
  auth: typeof AuthInstance,
  email: string,
  headers: HeadersInit = ORIGIN,
): Promise<{ headers: Headers; response: unknown }> {
  const otp = await auth.api.createVerificationOTP({ body: { email, type: "sign-in" } });

  return auth.api.signInEmailOTP({ body: { email, otp }, headers: new Headers(headers), returnHeaders: true });
}

/** A session row as the library's in-memory store holds one. */
export type SessionRow = {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  authFactor?: string;
  passkeyCredentialId?: string;
};

/** The library's in-memory store, typed as far as a case reads it. */
export type MemoryStore = {
  user: ({ id: string; email: string } & Record<string, unknown>)[];
  session: SessionRow[];
  account: unknown[];
  verification: { id: string; identifier: string; value: string; expiresAt: Date; createdAt: Date; updatedAt: Date }[];
  passkey: Record<string, unknown>[];
};

/** An empty store, held at `globalThis[name]`, where `memoryAdapterDouble(name)` serves it from. */
export function memoryStore(name: string): MemoryStore {
  const store: MemoryStore = { user: [], session: [], account: [], verification: [], passkey: [] };
  Reflect.set(globalThis, name, store);

  return store;
}

/** `signInByCode`'s session, as its cookie and the row `store` holds for it. */
export async function sessionByCode(
  auth: typeof AuthInstance,
  store: MemoryStore,
  email: string,
): Promise<{ cookie: string; row: SessionRow }> {
  const cookie = cookieHeader(await signInByCode(auth, email));

  const row = store.session.at(-1);
  assert.ok(row !== undefined, "the verification wrote no session row");

  return { cookie, row };
}

/** Where the sign-in gate's one backend read goes, in every config double this file builds. */
export const GATE_BACKEND_CONFIG = {
  API_URL: "http://backend.test",
  API_VERSION: 0,
} as const;

/** What the lookup answers an address holding nothing, which every answer below builds on. */
export const HOLDS_NOTHING = deepFrozen({ acknowledged: 1 as const, ...NO_RECORDS });

/** `ADMIN_EMAIL`'s answer: a grant and no league record, which is what makes it an administrator, dated before any session a case makes. */
const GRANTED = deepFrozen({ ...HOLDS_NOTHING, verwaltung: "administration" as const, berechtigt_seit: "2026-01-01T00:00:00Z", konto: false });

/** Whether a suite's lookup answer is installed, which `registerAuthDoubles`' default must not replace. */
let lookupAnswered = false;

/**
 * Answers the lookup and the sign-in gate by the address each posts, in the shape each reads; `null`
 * fails the read as an unreachable backend does.
 */
function answerTheLookup(answerFor: (email: string) => LookupFixture | null): void {
  lookupAnswered = true;
  const original = globalThis.fetch;

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const { email } = JSON.parse(String(init?.body ?? "{}")) as { email?: string };
    const answer = answerFor(email ?? "");
    if (answer === null) return Promise.reject(new TypeError("fetch failed"));

    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    return Promise.resolve(
      new Response(JSON.stringify(answerAt(path, answer)), { status: 200, headers: { "content-type": "application/json" } }),
    );
  }) as typeof globalThis.fetch;
  after(() => {
    globalThis.fetch = original;
  });
}

/**
 * Answers the gate's backend read with a live seat for every address, and a grant beside it for each
 * address `granted` names, so a suite minting a person's session gets past the gate at session creation
 * (`docs/frontend/spec.md :: I403`).
 */
export function seatEveryAddress(granted: readonly string[] = [ADMIN_EMAIL]): void {
  answerTheLookup((email) => ({ ...(granted.includes(email) ? GRANTED : HOLDS_NOTHING), sitze: [SITZ], konto: true }));
}

/**
 * Stamps a stored session a passkey's and seeds the passkey row its credential names: every guard
 * reads a passkey session whose passkey no row holds as no session (`docs/frontend/spec.md :: I313`).
 */
export function madeByPasskey(store: { passkey: unknown[] }, row: { userId: string; authFactor?: string; passkeyCredentialId?: string }): void {
  const credentialID = `fabricated-credential-of-${row.userId}`;
  row.authFactor = "passkey";
  row.passkeyCredentialId = credentialID;

  if (store.passkey.some((held) => typeof held === "object" && held !== null && Reflect.get(held, "credentialID") === credentialID)) return;
  store.passkey.push({
    id: `ein-passkey-of-${row.userId}`,
    userId: row.userId,
    credentialID: credentialID,
    publicKey: "fabricated-public-key",
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
    transports: "internal",
    createdAt: new Date(),
  });
}

/**
 * The code out of the last message mailed to `email`, or `null` where none was. Read off the send
 * rather than the store: `storeOTP: "encrypted"` means the stored value is not the code.
 */
export function lastMailedCode(sent: readonly { to: string; text: string }[], email: string): string | null {
  const message = [...sent].reverse().find((entry) => entry.to === email);
  if (message === undefined) return null;

  // The code stands on a line of its own in the text branch.
  const found = /^(\d{6})$/m.exec(message.text);
  assert.ok(found?.[1], `the message to ${email} carries no code`);

  return found[1];
}
