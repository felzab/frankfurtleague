import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { afterEach, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";

import { blankComments } from "@/core/blankComments.ts";

import type { SubjectSession } from "@/core/subject.ts";
import type { ActionFailure } from "@/shared/types/types.ts";

/** One write a component sent: the action's exported name, and the payload it was handed. */
export type ActionCall = { action: string; payload: unknown };

/**
 * The modules a real action sends its writes through. Replaced here they record no write, so the admin
 * spine would answer a press that wrote as one that did not; their doubles are the client's and the mailer's.
 */
const WRITE_MODULE = /\/(?:mutations|notifications)\.ts$|\/core\/mail\.ts$/;

/**
 * A name a generated module declares, spelled into its source where no literal can hold it: refused
 * unless it is an identifier, so nothing read off a real module can write code into the double.
 */
function identifier(name: string): string {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error(`${JSON.stringify(name)} is no name a module can declare`);
  return name;
}

let modulesBuilt = 0;

/**
 * Each value crosses through a global and never as a literal in the source, which spells identifiers
 * alone: a value written into code is safe only while every escape it passed through holds.
 */
export function exportingModule(values: Readonly<Record<string, unknown>>): string {
  // A slot per module, since two modules can load before either evaluates.
  const slot = `__flDoubledModule${String((modulesBuilt += 1))}`;
  Reflect.set(globalThis, slot, values);
  return `export const { ${Object.keys(values).map(identifier).join(", ")} } = globalThis.${slot};`;
}

/**
 * Replaces an actions module, or a read module a real action calls, at the module boundary: a
 * test-only prop would be a seam in production code.
 */
export function doubleActions({
  modules,
  answer = () => Promise.resolve({ success: true, message: "Gespeichert." }),
}: {
  /** Each module to replace, matched against the RESOLVED url: a path tail, or a pattern over one. */
  modules: readonly (string | RegExp)[];
  /** What every replaced write answers, until `answerWith` names another for the rest of that case. */
  answer?: () => Promise<unknown>;
}): {
  calls: ActionCall[];
  answerWith: (next: () => Promise<unknown>) => void;
  answerPending: (answer: unknown) => void;
  leavePending: (reason: string) => void;
} {
  const calls: ActionCall[] = [];
  let answering = answer;
  const pending = new Set<{ action: string; release: (answer: unknown) => void }>();
  let mayLeavePending = false;
  // Back to `answer` before every case: a case that named another answer and never restored it
  // would otherwise hand that answer to the next case's write, which then passes on it.
  beforeEach(() => {
    answering = answer;
    mayLeavePending = false;
  });
  // A call left unanswered holds its transition past the case, where React can hold a later case's
  // transition behind it, so it fails the case that left it rather than the one it next reaches.
  afterEach(() => {
    const left = [...pending].map(({ action }) => action);
    pending.clear();
    if (!mayLeavePending) {
      assert.deepEqual(left, [], "the case left these actions pending: answer them with `answerPending`, or name why with `leavePending`");
    }
  });
  const answerOf = (action: string): Promise<unknown> => {
    let release: (answer: unknown) => void = () => undefined;
    // Raced rather than replaced, so a case's own held answer still decides until the case answers it.
    const answered = Promise.race([answering(), new Promise((resolve) => (release = resolve))]);
    const entry = { action, release };
    pending.add(entry);
    const settle = (): void => void pending.delete(entry);
    answered.then(settle, settle);
    return answered;
  };
  const act =
    (action: string) =>
    async (payload: unknown): Promise<unknown> => {
      calls.push({ action, payload });
      return answerOf(action);
    };

  // Registered as this call evaluates, so it stands above the caller's own `await import` of the component,
  // whose graph reaches the real module.
  registerHooks({
    load(url, context, nextLoad) {
      if (!modules.some((named) => (typeof named === "string" ? url.endsWith(named) : named.test(url)))) return nextLoad(url, context);
      if (WRITE_MODULE.test(url)) {
        throw new Error(`${url} sends a write the admin spine judges its answer by; double its client with doubleApiAnswers instead`);
      }

      const real = blankComments(readFileSync(fileURLToPath(url), "utf8"));
      const names = [...real.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map(([, name = ""]) => name);
      const source = exportingModule(Object.fromEntries(names.map((name) => [name, act(name)])));

      return { format: "module", source, shortCircuit: true };
    },
  });

  return {
    calls,
    answerWith: (next) => void (answering = next),
    answerPending: (answer) => {
      for (const { release } of pending) release(answer);
    },
    // A reason rather than a flag, so the case that holds a write open says at its call why it may.
    leavePending: (reason) => {
      assert.ok(reason.trim() !== "", "name why the case may leave its actions pending");
      mayLeavePending = true;
    },
  };
}

/**
 * Every slice's actions module, for a suite in which no case saves: a real write module loads the
 * sign-in store and its database driver into the render, which is most of such a suite's time.
 */
export function doubleEveryAction(): ReturnType<typeof doubleActions> {
  return doubleActions({ modules: [/\/src\/features\/\w+\/actions\.ts$/] });
}

const asModule = (source: string): string => `data:text/javascript,${encodeURIComponent(source)}`;

/** One invalidation a write made through `next/cache`: the export it called, and what it handed it. */
export type CacheCall = { name: string; args: unknown[] };

/** Every invalidation since the case began, `doubleActionRequest` emptying it before each case. */
export const cacheCalls: CacheCall[] = [];

const recorded = (names: readonly string[]): Record<string, (...args: unknown[]) => void> =>
  Object.fromEntries(
    names.map((name) => [
      name,
      (...args: unknown[]): void => {
        cacheCalls.push({ name, args });
      },
    ]),
  );

const INERT_DECLARATIONS = { cacheLife: (): undefined => undefined, cacheTag: (): undefined => undefined };

/**
 * `next/cache` as a server action meets it, every invalidation recorded into `cacheCalls`, for a
 * harness that doubles its packages itself. `cacheLife` and `cacheTag` declare a cached read rather
 * than clear one, so they record nothing.
 */
export const NEXT_CACHE_DOUBLE = exportingModule({
  ...recorded(["updateTag", "refresh", "revalidateTag", "revalidatePath"]),
  ...INERT_DECLARATIONS,
});

/** Next's two invalidations that throw in a route handler, being a Server Action's alone. */
export const ACTION_ONLY_INVALIDATIONS = ["updateTag", "refresh"];

/**
 * `next/cache` as a route handler meets it: each of `ACTION_ONLY_INVALIDATIONS` throws there, as Next's
 * does, and is recorded first, since a route may catch the throw and answer as though it cleared.
 */
export const ROUTE_NEXT_CACHE_DOUBLE = exportingModule({
  ...recorded(["revalidateTag", "revalidatePath"]),
  ...Object.fromEntries(
    ACTION_ONLY_INVALIDATIONS.map((name) => [
      name,
      (...args: unknown[]): never => {
        cacheCalls.push({ name, args });
        throw new Error(`${name} can only be called from within a Server Action`);
      },
    ]),
  ),
  ...INERT_DECLARATIONS,
});

/** `next/headers` for a request that carries none, for a harness that doubles its packages itself. */
export const NEXT_HEADERS_DOUBLE = "export const headers = async () => new Headers();";

/**
 * Each answers only inside a request Next itself is serving: `updateTag`, `refresh` and `headers`
 * throw outside one, and `server-only` throws outside a server build.
 */
export const REQUEST_PACKAGES: Readonly<Record<string, string>> = {
  "server-only": "export {};",
  "next/cache": NEXT_CACHE_DOUBLE,
  "next/headers": NEXT_HEADERS_DOUBLE,
};

/** Every refusal an action logs would otherwise reach the run's output as an error line. */
const SILENT_LOGGER = "const inert = () => undefined; export const logger = { debug: inert, info: inert, warn: inert, error: inert };";

/** What the doubled sign-in store's `getAdminSession` answers: an administrator, nobody signed in, or a store that threw this. */
type AdminSessionDouble = { user: { email: string } } | null | Error;

/** What the doubled `getSubjectSession` answers: a person's records, no person signed in, or a lookup that threw this. */
type SubjectDouble = SubjectSession | null | Error;

/** What one request's doubled sign-in store answers, until `setSession` or `setSubject` names another for the rest of that case. */
type SignInAnswers = {
  session: AdminSessionDouble;
  destination: string;
  subject: SubjectDouble;
  subjectReads: number;
  /** Every address a ban asked the store to sign out, in order. */
  signedOut: string[];
  /** What that sign-out throws, where a case asks it to fail. */
  signOutFailure: Error | null;
};

/** Where the real store sends a caller the session leaves out, when a case names no other. */
const destinationOf = (session: AdminSessionDouble): string =>
  // eslint-disable-next-line local/admin-link -- the sign-in store's own landing, which carries no season
  session === null ? "/signin" : "/bereich/admin";

const answering = (answer: unknown): Promise<unknown> => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer));

/**
 * The session, recorded as the request's actor where it is an administrator's, as the real
 * `getAdminSession` records it. Imported at the call, so the scope is the one the code under test loaded.
 */
async function administratorOf(session: AdminSessionDouble): Promise<unknown> {
  if (session !== null && !(session instanceof Error)) {
    const { setRequestActor } = await import("@/core/requestScope.ts");
    const { asSignInIdentifier } = await import("@/core/emailAddress.ts");
    setRequestActor(asSignInIdentifier(session.user.email));
  }

  return answering(session);
}

/**
 * `url`'s module with `doubled` standing in for the exports it names, the real one opening the
 * database driver as it loads. Every other export throws where called, its name read off the real
 * module so an import links.
 */
function sessionModule(url: string, what: string, doubled: ReadonlyMap<string, (...args: unknown[]) => Promise<unknown>>): string {
  const names = [...readFileSync(fileURLToPath(url), "utf8").matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map(
    ([, name = ""]) => name,
  );

  return exportingModule(
    Object.fromEntries(
      names.map((name) => [
        name,
        doubled.get(name) ??
          ((): never => {
            throw new Error(`${what}'s ${name} is not doubled`);
          }),
      ]),
    ),
  );
}

/** The sign-in store answering the session and the sign-in destination `doubleActionRequest` holds. */
const signInStore = (url: string, answers: SignInAnswers): string =>
  sessionModule(
    url,
    "the sign-in store",
    new Map([
      ["getAdminSession", () => administratorOf(answers.session)],
      ["getSignInDestination", () => Promise.resolve(answers.destination)],
      [
        "endSessionsOfAddress",
        (address: unknown) => {
          answers.signedOut.push(String(address));
          return answering(answers.signOutFailure ?? undefined);
        },
      ],
    ]),
  );

/**
 * The subject lookup answering what `doubleActionRequest` holds, counting every read: the real one
 * calls the sign-in store this file replaces, and reads the doubled `auth` it cannot build.
 */
const subjectLookup = (url: string, answers: SignInAnswers): string =>
  sessionModule(
    url,
    "the subject lookup",
    new Map([
      [
        "getSubjectSession",
        () => {
          answers.subjectReads += 1;
          return answering(answers.subject);
        },
      ],
    ]),
  );

/**
 * The request a server action runs in, so a case calls the REAL action, its `mutations.ts` doubled
 * through `doubleActions`. Registered before the action's `await import`, as `doubleActions` is.
 */
export function doubleActionRequest({
  session = { user: { email: "vorstand@example.org" } },
  subject = null,
}: {
  /** Who the request is signed in as, until `setSession` names another for the rest of that case; `null` for nobody. */
  session?: AdminSessionDouble;
  /** What the subject lookup answers, until `setSubject` names another for the rest of that case; `null` for no person. */
  subject?: SubjectDouble;
} = {}): {
  setSession: (next: AdminSessionDouble, destination?: string) => void;
  setSubject: (next: SubjectDouble) => void;
  /** How often `getSubjectSession` was called since the case began. */
  subjectReads: () => number;
  /** Every address a ban signed out since the case began. */
  signedOut: () => readonly string[];
  /** Makes every sign-out for the rest of the case throw `failure`. */
  failSignOut: (failure: Error) => void;
} {
  const answers: SignInAnswers = {
    session,
    destination: destinationOf(session),
    subject,
    subjectReads: 0,
    signedOut: [],
    signOutFailure: null,
  };
  // The destination goes with the session, so a case cannot leave one standing that another case's session contradicts.
  const setSession = (next: AdminSessionDouble, destination = destinationOf(next)): void => {
    answers.session = next;
    answers.destination = destination;
  };
  const setSubject = (next: SubjectDouble): void => void (answers.subject = next);
  // Before every case: one reading `cacheCalls` would otherwise also read every earlier case's
  // invalidations, and one after a case that signed out would run its write with no session.
  beforeEach(() => {
    cacheCalls.length = 0;
    setSession(session);
    setSubject(subject);
    answers.subjectReads = 0;
    answers.signedOut.length = 0;
    answers.signOutFailure = null;
  });
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const double = REQUEST_PACKAGES[specifier];
      return double === undefined ? nextResolve(specifier, context) : { url: asModule(double), shortCircuit: true };
    },
    load(url, context, nextLoad) {
      // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
      if (url.endsWith("/src/core/auth.ts")) return { format: "module", source: signInStore(url, answers), shortCircuit: true };
      if (url.endsWith("/src/core/subject.ts")) return { format: "module", source: subjectLookup(url, answers), shortCircuit: true };
      if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: SILENT_LOGGER, shortCircuit: true };
      return nextLoad(url, context);
    },
  });

  return {
    setSession,
    setSubject,
    subjectReads: () => answers.subjectReads,
    signedOut: () => [...answers.signedOut],
    failSignOut: (failure) => void (answers.signOutFailure = failure),
  };
}

/** One announcement a component raised: the severity it chose, and the words it handed the reader. */
export interface RaisedToast {
  readonly variant: string;
  readonly title: string;
  readonly description: string | undefined;
  /** Everything else the call passed: where an undo offer keeps its own `onPress`, and `failure` its marker. */
  readonly options: { description?: string; actionProps?: { onPress?: () => void }; outcome?: "unknown" } | undefined;
}

const TOAST_MODULE = "/src/shared/utils/appToast.ts";

/**
 * The members of the real `appToast`, derived from its source: a double short of one answers
 * `undefined` where a component raises it, and fails on the call rather than on its subject.
 */
function toastMembers(): string[] {
  const file = path.resolve(import.meta.dirname, "..", "utils", "appToast.ts");
  const source = blankComments(readFileSync(file, "utf8"), file);
  const from = source.indexOf("export const appToast = {");
  if (from === -1) throw new Error("appToast.ts declares no appToast object for the double to mirror");

  return [...source.slice(from, source.indexOf("\n};", from)).matchAll(/^ {2}(\w+):/gm)].map(([, name]) => name ?? "");
}

/**
 * Replaces the toast module at the module boundary, every severity recording its call.
 *
 * The real module hands its raising to HeroUI's queue rather than back to the caller.
 */
export function doubleToasts(): { raised: RaisedToast[] } {
  const raised: RaisedToast[] = [];
  const raise =
    (variant: string) =>
    (title: string, options?: RaisedToast["options"]): string => {
      raised.push({ variant, title, description: options?.description, options });
      return String(raised.length);
    };
  // `failure` keeps the site's title: the real module swaps in the neutral one, and
  // `fl_frontend/src/shared/utils/appToast.test.ts` pins that.
  const fail = (title: string, failure?: Pick<ActionFailure, "error" | "unplacedError" | "outcome">): string =>
    raise("danger")(title, { description: failure?.unplacedError ?? failure?.error, outcome: failure?.outcome });
  const inert = (): undefined => undefined;

  // `close` and `clear` raise nothing, and recording them would shift every index `raised` is read by.
  const members = toastMembers().map((name) => [name, name === "close" || name === "clear" ? inert : name === "failure" ? fail : raise(name)]);
  const source = exportingModule({ UNDO_TIMEOUT_MS: 1, appToast: Object.fromEntries(members) });

  registerHooks({
    load(url, context, nextLoad) {
      // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
      if (!url.endsWith(TOAST_MODULE)) return nextLoad(url, context);

      return { format: "module", source, shortCircuit: true };
    },
  });

  return { raised };
}
