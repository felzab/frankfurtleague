import { answerInEveryCase, answerWhereUnanswered, BACKEND_ORIGIN, caseRunning, networkFailure } from "@/test-support/backend.ts";
import { answerAt, deepFrozen, NO_RECORDS, SEAT } from "@/test-support/subjectFixtures.ts";
import { TEST_SECRETS } from "@/test-support/testEnvironment.mts";
import { memoryAdapter } from "better-auth/adapters/memory";
import { symmetricDecrypt } from "better-auth/crypto";
import { ObjectId } from "mongodb";
import { assert, beforeEach, onTestFinished, vi } from "vitest";

import type { auth as AuthInstance } from "@/core/auth/library.ts";
import type { MailSender } from "@/core/emailShell.ts";
import type { FLOutboxSignInPayload } from "@/core/generated/client/types.ts";
import type { LookupFixture } from "@/test-support/subjectFixtures.ts";
import type { MemoryDB } from "better-auth/adapters/memory";

/** A module's doubled exports, by name: a name the double leaves out fails on Vitest's missing-export error. */
export type DoubledExports = Readonly<Record<string, unknown>>;

/** What stands in for a module: its doubled exports, or a factory building them, as `vi.doMock` takes one. */
type ModuleDouble = DoubledExports | (() => Promise<DoubledExports>);

/**
 * The real module at `specifier` with the exports `overrides` names rebuilt from the real ones: every
 * other export is the module's own.
 */
export const overriding =
  (specifier: string, overrides: Readonly<Record<string, (real: DoubledExports) => unknown>> = {}): (() => Promise<DoubledExports>) =>
  async () => {
    const real = await vi.importActual<DoubledExports>(specifier);
    return { ...real, ...Object.fromEntries(Object.entries(overrides).map(([name, build]) => [name, build(real)])) };
  };

export const ADMIN_EMAIL = "vorstand@example.org";

/** What a request arriving at the served origin carries, matched to the config double's `AUTH_URL`. */
export const ORIGIN = { host: "localhost:3000", "x-forwarded-proto": "http" } as const;

/** A secret's reader in the config, by its exported name, as a double answers it. */
type SecretReaders = Readonly<Record<string, () => string | undefined>>;

/** The run's own secret files, as the real config reads them, so a double hands a suite the same values. */
const SECRET_DOUBLES: SecretReaders = {
  authSecret: () => TEST_SECRETS.auth_secret,
  internalApiKeySystem: () => TEST_SECRETS.internal_api_key_system,
  internalApiKeyBase: () => TEST_SECRETS.internal_api_key_base,
  internalApiKeyAdmin: () => TEST_SECRETS.internal_api_key_admin,
};

/** A config standing in for the real one where a suite must vary a value per file, `secrets` over the run's own. */
export function configDouble(overrides: Readonly<Record<string, unknown>> = {}, secrets: SecretReaders = {}): DoubledExports {
  const config = {
    ...GATE_BACKEND_CONFIG,
    AUTH_URL: `http://${ORIGIN.host}`,
    ...overrides,
  };
  // An override of `undefined` takes the name out, as an unset variable is absent from the real config.
  const frontend_config = Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined));
  return { frontend_config, ...SECRET_DOUBLES, ...secrets };
}

/* Replaced here rather than the adapter being given a seam: the real client needs a `MONGODB_URI`
   the run's secret files omit, and with one a suite left on the real adapter would reach for a server
   rather than fail at once. */
const DB_DOUBLE: DoubledExports = { signInStore: () => ({ db: () => ({}) }) };

/** What the library hands an adapter factory as it builds the adapter. */
type AdapterOptions = Parameters<ReturnType<typeof memoryAdapter>>[0];

/**
 * The library's in-memory adapter over `store`, minting ids as the Mongo adapter does rather than at
 * random: an `ObjectId` rising with each insert, which settles which of two sessions stamped in one
 * millisecond was minted first.
 */
export const insertOrderedAdapter =
  (store: MemoryDB) =>
  (options: AdapterOptions): ReturnType<ReturnType<typeof memoryAdapter>> =>
    memoryAdapter(store)({
      ...options,
      advanced: { ...options.advanced, database: { ...options.advanced?.database, generateId: () => new ObjectId().toHexString() } },
    });

/** An adapter operation's first argument, as far as a fault reads it. */
type AdapterQuery = { model?: string; where?: readonly { field: string; value: unknown }[] };

/**
 * `adapter` refusing every operation `fail` answers an error for with that error, as a failing store refuses it, and
 * passing on every other. `fail` is asked at each call, so it reads what the running case set, and a transaction's own
 * adapter is wrapped alike, so a fault reaches the writes inside one too.
 */
export const faultingAdapter = <T extends object>(adapter: T, fail: (operation: string, query: AdapterQuery) => Error | undefined): T =>
  new Proxy(adapter, {
    get: (target, key) => {
      const value: unknown = Reflect.get(target, key);
      if (typeof value !== "function" || typeof key !== "string") return value;
      return (...args: unknown[]) => {
        if (key === "transaction") {
          const [run] = args as [(held: object) => Promise<unknown>];
          return (value as (run: (held: object) => Promise<unknown>) => Promise<unknown>).call(target, (held) =>
            run(faultingAdapter(held, fail)),
          );
        }
        const fault = fail(key, (args[0] ?? {}) as AdapterQuery);
        if (fault !== undefined) return Promise.reject(fault);
        return (value as (...rest: unknown[]) => unknown).apply(target, args);
      };
    },
  });

/**
 * The Mongo adapter reaches a real server through aggregation pipelines, so the store under the real sign-in
 * library is the library's own in-memory one, over the object held at `globalThis[store]`.
 */
export const memoryAdapterDouble = (store: string): DoubledExports => ({
  mongodbAdapter: () => insertOrderedAdapter(Reflect.get(globalThis, store) as MemoryDB),
});

/** One sign-in mail the double sent, rendered as the drain renders it. */
type SentMail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  sender: MailSender;
};

/** How the double answers one owed sign-in mail: sent, or `lost`, a backend that never answered the enqueue. */
type MailAnswer = (mail: SentMail) => "accepted" | "lost" | Promise<"accepted" | "lost">;

/** The path the sign-in library owes its mails through, as the generated call spells it below the base path. */
const OUTBOX_SIGN_IN_PATH = "/outbox/sign_in";

/**
 * Answers the Postausgang's enqueue on the backend and drains it in one step: a sign-in mail owed is recorded as the
 * backend would store it, then opened and rendered as the drain does, under the suite's own key, and sent; every other mail is owed by the backend's own write and drained by nothing here.
 */
function doubleOutbox(): {
  sent: SentMail[];
  owed: FLOutboxSignInPayload[];
  answerWith: (next: MailAnswer) => void;
} {
  const sent: SentMail[] = [];
  // Every sign-in mail owed through the Postausgang, as the backend was handed it.
  const owed: FLOutboxSignInPayload[] = [];
  const accepted: MailAnswer = () => "accepted";
  let answering = accepted;

  answerInEveryCase(async ({ method, path, body }) => {
    if (method !== "POST" || path !== OUTBOX_SIGN_IN_PATH) return undefined;
    const payload = body as FLOutboxSignInPayload;

    // Imported at the request, after the suite's own doubles, so the config and the kinds are the ones it loaded.
    const [{ authSecret, frontend_config }, { mailFor }, { renderMail }] = await Promise.all([
      import("@/core/config.ts"),
      import("@/core/mailKinds.ts"),
      import("@/core/emailShell.ts"),
    ]);
    const secret = payload.secret === null ? null : await symmetricDecrypt({ key: authSecret(), data: payload.secret });
    const message = mailFor(payload.data.kind, payload.data, { token: null, secret, origin: frontend_config.AUTH_URL });
    assert(message !== undefined, `no builder renders the sign-in kind ${payload.data.kind}`);
    const mail = { to: payload.to, ...renderMail(message) };

    // A backend that never answered the enqueue, as the client meets one: the request fails on the network.
    if ((await answering(mail)) === "lost") return networkFailure();

    owed.push(payload);
    sent.push(mail);
    return new Response(null, { status: 204 });
  });

  // Back to accepted before every case: a case that named `lost` would hand it to the next case's mail.
  beforeEach(() => {
    sent.length = 0;
    owed.length = 0;
    answering = accepted;
  });

  return { sent, owed, answerWith: (next) => void (answering = next) };
}

type AuthDoubles = {
  /** By the `fl_frontend/src/core/<name>.ts` each replaces, over the store client's default. */
  readonly core?: Readonly<Record<string, ModuleDouble>>;
  /** By the bare specifier each replaces. */
  readonly specifiers?: Readonly<Record<string, ModuleDouble>>;
};

/**
 * Doubles, through `vi.doMock`, the store client the sign-in library builds on, and answers on the
 * file's backend the lookup its grant is read over and the Postausgang its mails are owed through. The library runs
 * under the real config, over the run's environment and secret files, unless `core` names a `config` of its own.
 */
export function registerAuthDoubles({ core = {}, specifiers = {} }: AuthDoubles = {}): ReturnType<typeof doubleOutbox> {
  // The mailer is always `doubleOutbox`'s, whose record this answers. A second one is refused rather
  // than layered: two mailer hooks answer by registration order, and a suite would read whichever came last.
  if ("mail" in core) throw new Error("The mailer is doubleOutbox's: read the record registerAuthDoubles answers.");
  const modules = Object.entries({ db: DB_DOUBLE, ...core }).map(([name, double]): [string, ModuleDouble] => [`@/core/${name}.ts`, double]);

  // The grant is read over the lookup, so without an answer no suite has an administrator at all. Only where nothing
  // else answers it: a suite answering the lookup, before this or after it, or the whole backend itself, keeps its own.
  answerWhereUnanswered(lookupBy(() => (lookupAnswer() === undefined ? DEFAULT_LOOKUP : undefined)));

  // Each reaches only the modules the suite imports after this call.
  const doubles: [string, ModuleDouble][] = [...modules, ...Object.entries(specifiers)];
  for (const [specifier, double] of doubles) {
    vi.doMock(specifier, typeof double === "function" ? double : () => double);
  }

  return doubleOutbox();
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

/** One `name=value` pair of a `Cookie` header as an entry, split at its first `=`. */
export function cookiePair(pair: string): [name: string, value: string] {
  const at = pair.indexOf("=");
  return at === -1 ? [pair, ""] : [pair.slice(0, at), pair.slice(at + 1)];
}

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
  assert(row !== undefined, "the verification wrote no session row");

  return { cookie, row };
}

/** Where the sign-in gate's one backend read goes, in every config double this file builds. */
export const GATE_BACKEND_CONFIG = {
  API_URL: BACKEND_ORIGIN,
} as const;

/** What the lookup answers an address holding nothing, which every answer below builds on. */
export const HOLDS_NOTHING = NO_RECORDS;

/** `ADMIN_EMAIL`'s answer: a grant and no league record, which is what makes it an administrator, dated before any session a case makes. */
export const GRANTED = deepFrozen({
  ...HOLDS_NOTHING,
  admin_tier: "administration" as const,
  granted_since: "2026-01-01T00:00:00Z",
  account: false,
});

/** How the lookup answers one address: its records, `null` for a backend that fails the read, or `undefined` to leave it to the case. */
type LookupAnswer = (email: string) => LookupFixture | null | undefined;

/** The file's lookup answer, named outside any case, which `registerAuthDoubles`' default must not replace. */
let fileLookup: LookupAnswer | undefined;

/** The running case's own lookup answer, ahead of the file's until the case ends. */
let caseLookup: LookupAnswer | undefined;

/** Whether a lookup answer stands on the backend yet: it stands once, reading whichever answer holds at each request. */
let lookupStands = false;

/** The answer a lookup meets now: the case's own, else the file's. */
const lookupAnswer = (): LookupAnswer | undefined => caseLookup ?? fileLookup;

/** The two reads the lookup answers, as the generated calls spell them below the base path. */
const LOOKUP_PATHS: ReadonlySet<string> = new Set(["/identity/subject", "/identity/sign_in"]);

/**
 * Answers the subject read and the sign-in gate on the file's backend by the address each posts, in the shape each
 * reads: `null` fails the read on the network, as an unreachable backend does, and `undefined` leaves it to the case's
 * own answer. Called outside a case it answers every case of the file; inside one, the rest of that case alone, the
 * file's answer holding again from the next.
 */
export function answerTheLookup(answerFor: LookupAnswer): void {
  if (!lookupStands) answerInEveryCase(lookupBy(lookupAnswer));
  lookupStands = true;
  if (!caseRunning()) {
    fileLookup = answerFor;
    return;
  }

  caseLookup = answerFor;
  onTestFinished(() => {
    caseLookup = undefined;
  });
}

/** The lookup answering through whichever answer `current` reads at each request. */
const lookupBy =
  (current: () => LookupAnswer | undefined) =>
  ({ method, path, body }: { method: string; path: string; body: unknown }): unknown => {
    const answerFor = current();
    if (method !== "POST" || !LOOKUP_PATHS.has(path) || answerFor === undefined) return undefined;
    const { email } = (body ?? {}) as { email?: string };
    const answer = answerFor(email ?? "");
    if (answer === undefined) return undefined;

    return answer === null ? networkFailure() : answerAt(path, answer);
  };

/**
 * `ADMIN_EMAIL`'s grant, and no answer for any other address: a read of one the suite did not answer fails its case,
 * and a suite meaning a backend that fails the read says so with `answerTheLookup(() => null)`.
 */
const DEFAULT_LOOKUP: LookupAnswer = (email) => (email === ADMIN_EMAIL ? GRANTED : undefined);

/**
 * Answers the gate's backend read with a live seat for every address, and a grant beside it for each
 * address `granted` names, so a suite minting a person's session gets past the gate at session creation.
 */
export function seatEveryAddress(granted: readonly string[] = [ADMIN_EMAIL]): void {
  answerTheLookup((email) => ({ ...(granted.includes(email) ? GRANTED : HOLDS_NOTHING), seats: [SEAT], account: true }));
}

/**
 * Stamps a stored session a passkey's and seeds the passkey row its credential names: every guard
 * reads a passkey session whose passkey no row holds as no session.
 */
export function madeByPasskey(store: { passkey: unknown[] }, row: { userId: string; authFactor?: string; passkeyCredentialId?: string }): void {
  const credentialID = `fabricated-credential-of-${row.userId}`;
  row.authFactor = "passkey";
  row.passkeyCredentialId = credentialID;

  if (store.passkey.some((held) => typeof held === "object" && held !== null && Reflect.get(held, "credentialID") === credentialID)) return;
  store.passkey.push({
    id: `a-passkey-of-${row.userId}`,
    userId: row.userId,
    credentialID,
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
  assert(found?.[1], `the message to ${email} carries no code`);

  return found[1];
}
