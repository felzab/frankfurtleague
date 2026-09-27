import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after } from "node:test";

import { memoryAdapter } from "better-auth/adapters/memory";

import { exportingModule } from "./exportingModule.ts";
import { doubleSendMail } from "./mailDouble.ts";

import type { MemoryDB } from "better-auth/adapters/memory";
import type { auth as AuthInstance } from "./auth.ts";

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

export const asDataUrl = (source: string): string => `data:text/javascript,${encodeURIComponent(source)}`;

/**
 * The config every sign-in suite runs `fl_frontend/src/core/auth.ts` under. The secret is fabricated
 * and reaches the library as its `secret` option, which it reads ahead of `BETTER_AUTH_SECRET` and
 * `AUTH_SECRET`, so neither environment name needs setting for a run.
 */
export function configDouble(overrides: Readonly<Record<string, unknown>> = {}): string {
  const config = {
    ...GATE_BACKEND_CONFIG,
    AUTH_URL: `http://${ORIGIN.host}`,
    AUTH_SECRET: "fabricated-test-secret-not-a-credential",
    ACTOR_SIGNING_KEY_FILE: ACTOR_KEY_FILE,
    LOG_LEVEL: "ERROR",
    LOG_FORMAT: "json",
    ...overrides,
  };
  // An override of `undefined` takes the name out, as an unset variable is absent from the real config.
  return exportingModule({ frontend_config: Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)) });
}

/* Replaced here rather than the adapter being given a seam: the real client needs a `MONGODB_URI`
   the config above omits, and with one a suite left on the real adapter would reach for a server
   rather than fail at once. */
const DB_DOUBLE = `export const client = { db: () => ({}) };`;

/**
 * The Mongo adapter reaches a real server through aggregation pipelines, so the store under the real
 * `auth.ts` is the library's own in-memory one, over the object held at `globalThis[store]`.
 */
export const memoryAdapterDouble = (store: string): string =>
  asDataUrl(exportingModule({ mongodbAdapter: () => memoryAdapter(Reflect.get(globalThis, store) as MemoryDB) }));

const SERVER_ONLY_DOUBLE_URL = asDataUrl("export {};");

type Doubles = {
  /** Module sources by the `fl_frontend/src/core/<name>.ts` they replace, over the two defaults. */
  readonly core?: Readonly<Record<string, string>>;
  /** Module URLs by the bare specifier they replace. */
  readonly specifiers?: Readonly<Record<string, string>>;
};

/**
 * Registers the doubles a suite then imports `fl_frontend/src/core/auth.ts` under, which it does
 * with a dynamic import: a static one resolves before the hooks exist. Test-only, which
 * `no-restricted-imports` in `fl_frontend/eslint.config.mjs` holds it to.
 */
export function registerAuthDoubles({ core = {}, specifiers = {} }: Doubles = {}): ReturnType<typeof doubleSendMail> {
  // The mailer is always `doubleSendMail`'s, whose record this answers. A second one is refused rather
  // than layered: two mailer hooks answer by registration order, and a suite would read whichever came last.
  if ("mail" in core) throw new Error("The mailer is doubleSendMail's: read the record registerAuthDoubles answers.");
  const sources = Object.entries({ config: configDouble(), db: DB_DOUBLE, ...core });
  const replaced = new Map(Object.entries(specifiers));

  // The grant is read over the lookup, so without an answer no suite has an administrator at all. A
  // suite answering the lookup itself, before this or after it, keeps its own answer.
  if (!lookupAnswered) answerTheLookup((email) => (email === ADMIN_EMAIL ? GRANTED : null));

  registerHooks({
    resolve(specifier, context, nextResolve) {
      // Its real module throws outside a React server build.
      if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
      const url = replaced.get(specifier);
      if (url !== undefined) return { url: url, shortCircuit: true };
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      // Matched on the RESOLVED url's end, so this holds whichever order the alias hook and this one
      // run in, and a query-suffixed url passes: both db-tier suites load the real `db.ts` that way.
      const double = sources.find(([name]) => url.endsWith(`/src/core/${name}.ts`));
      if (double !== undefined) return { format: "module", source: double[1], shortCircuit: true };
      return nextLoad(url, context);
    },
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

/** Where the sign-in gate's one backend read goes, in every config double this file builds. */
export const GATE_BACKEND_CONFIG = {
  API_URL: "http://backend.test",
  API_VERSION: 0,
  INTERNAL_API_KEY_SYSTEM: "fabricated-system-not-a-credential",
} as const;

/** What the lookup answers an address holding nothing, which every answer below builds on. */
const HOLDS_NOTHING = { acknowledged: 1, sitze: [], spieler: [], schiedsrichter: [], unbestaetigt: false, gesperrt: false, verwaltung: null };

/** `ADMIN_EMAIL`'s answer: a grant and no league record, which is what makes it an administrator. */
const GRANTED = { ...HOLDS_NOTHING, verwaltung: "administration" };

/** Whether a suite's lookup answer is installed, which `registerAuthDoubles`' default must not replace. */
let lookupAnswered = false;

/** Answers the lookup by the address it posts; `null` fails the read as an unreachable backend does. */
function answerTheLookup(answerFor: (email: string) => Record<string, unknown> | null): void {
  lookupAnswered = true;
  const original = globalThis.fetch;

  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    const { email } = JSON.parse(String(init?.body ?? "{}")) as { email?: string };
    const answer = answerFor(email ?? "");
    if (answer === null) return Promise.reject(new TypeError("fetch failed"));

    return Promise.resolve(new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } }));
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
  const seat = { saison_id: "2026", team_id: "a".repeat(24), rolle: "trainer", team_name: "SV Bornheim 1945", saison_status: "active" };

  answerTheLookup((email) => ({ ...(granted.includes(email) ? GRANTED : HOLDS_NOTHING), sitze: [seat] }));
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
