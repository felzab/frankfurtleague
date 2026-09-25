import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { afterEach, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";

import { blankComments } from "@/core/blankComments.ts";

/** One write a component sent: the action's exported name, and the payload it was handed. */
export type ActionCall = { action: string; payload: unknown };

type Recorder = { push: (call: ActionCall) => void; answer: (action: string) => Promise<unknown> };

let registered = 0;

/**
 * A name a generated module declares, spelled into its source where no literal can hold it: refused
 * unless it is an identifier, so nothing read off a real module can write code into the double.
 */
function identifier(name: string): string {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error(`${JSON.stringify(name)} is no name a module can declare`);
  return name;
}

/**
 * Replaces an actions module, or the `mutations.ts` a real action calls, at the module boundary, every
 * export answering `answer` and recording its call: a test-only prop would be a seam in production code.
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
  // Through the global rather than a closure: the replaced module is compiled from source and shares
  // nothing with this scope. One name per call, so two doubles in one process cannot overwrite each other.
  const bus = `__flActionDouble${String((registered += 1))}`;
  const recorder: Recorder = {
    push: (call) => calls.push(call),
    answer: (action) => {
      let release: (answer: unknown) => void = () => undefined;
      // Raced rather than replaced, so a case's own held answer still decides until the case answers it.
      const answered = Promise.race([answering(), new Promise((resolve) => (release = resolve))]);
      const entry = { action, release };
      pending.add(entry);
      const settle = (): void => void pending.delete(entry);
      answered.then(settle, settle);
      return answered;
    },
  };
  Reflect.set(globalThis, bus, recorder);

  // Registered as this call evaluates, so it stands above the caller's own `await import` of the component,
  // whose graph reaches the real module.
  registerHooks({
    load(url, context, nextLoad) {
      if (!modules.some((named) => (typeof named === "string" ? url.endsWith(named) : named.test(url)))) return nextLoad(url, context);

      const real = blankComments(readFileSync(fileURLToPath(url), "utf8"));
      const exported = [...real.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)];
      const source = exported
        .map((match, index) => {
          const name = match[1] ?? "";
          // The record the API client makes as it sends the export's request, which the spine judges its
          // answer by: each export makes one call, a method other than GET without `readOnly: true` a write.
          const call = real.slice(match.index, exported[index + 1]?.index);
          const records = /method: "(?!GET")[A-Z]+"/.test(call) && !call.includes("readOnly: true") ? "recordWriteSent(); " : "";

          return `export const ${identifier(name)} = async (payload) => { ${records}const bus = globalThis.${bus}; bus.push({ action: ${JSON.stringify(name)}, payload }); return bus.answer(${JSON.stringify(name)}); };`;
        })
        .join("\n");

      return { format: "module", source: `import { recordWriteSent } from "@/core/requestScope";\n${source}`, shortCircuit: true };
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

// Through a global: the doubled package is compiled from source and shares nothing with this scope.
const CACHE_BUS = "__flNextCacheCalls";
Reflect.set(globalThis, CACHE_BUS, cacheCalls);

const recorded = (name: string): string =>
  `export const ${identifier(name)} = (...args) => void globalThis.${CACHE_BUS}.push({ name: ${JSON.stringify(name)}, args });`;

const INERT_DECLARATIONS = "const inert = () => undefined; export { inert as cacheLife, inert as cacheTag };";

/**
 * `next/cache` as a server action meets it, every invalidation recorded into `cacheCalls`, for a
 * harness that doubles its packages itself. `cacheLife` and `cacheTag` declare a cached read rather
 * than clear one, so they record nothing.
 */
export const NEXT_CACHE_DOUBLE = [...["updateTag", "refresh", "revalidateTag", "revalidatePath"].map(recorded), INERT_DECLARATIONS].join("\n");

/** Next's two invalidations that throw in a route handler, being a Server Action's alone. */
export const ACTION_ONLY_INVALIDATIONS = ["updateTag", "refresh"];

/**
 * `next/cache` as a route handler meets it: each of `ACTION_ONLY_INVALIDATIONS` throws there, as Next's
 * does, and is recorded first, since a route may catch the throw and answer as though it cleared.
 */
export const ROUTE_NEXT_CACHE_DOUBLE = [
  ...["revalidateTag", "revalidatePath"].map(recorded),
  ...ACTION_ONLY_INVALIDATIONS.map(
    (name) =>
      `export const ${identifier(name)} = (...args) => { globalThis.${CACHE_BUS}.push({ name: ${JSON.stringify(name)}, args }); throw new Error(${JSON.stringify(`${name} can only be called from within a Server Action`)}); };`,
  ),
  INERT_DECLARATIONS,
].join("\n");

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

// Through globals: the doubled store is compiled from source and shares nothing with this scope.
const SESSION_BUS = "__flAdminSession";
const DESTINATION_BUS = "__flSignInDestination";

/** Where the real store sends a caller the session leaves out, when a case names no other. */
const destinationOf = (session: AdminSessionDouble): string =>
  // eslint-disable-next-line local/admin-link -- the sign-in store's own landing, which carries no season
  session === null ? "/signin" : "/admin";

/**
 * The sign-in store answering the session and the sign-in destination `doubleActionRequest` holds,
 * the real one opening the database driver as it loads. Every other export throws where called, its
 * name read off the real module so an import links.
 */
function signInStore(url: string): string {
  const doubled: Record<string, string> = {
    getAdminSession: `export const getAdminSession = async () => {
  const session = globalThis.${SESSION_BUS};
  if (session instanceof Error) throw session;
  return session;
};`,
    getSignInDestination: `export const getSignInDestination = async () => globalThis.${DESTINATION_BUS};`,
  };
  return [...readFileSync(fileURLToPath(url), "utf8").matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)]
    .map(
      ([, name = ""]) =>
        doubled[name] ??
        `export const ${identifier(name)} = () => { throw new Error(${JSON.stringify(`the sign-in store's ${name} is not doubled`)}); };`,
    )
    .join("\n");
}

/**
 * The request a server action runs in, so a case calls the REAL action, its `mutations.ts` doubled
 * through `doubleActions`. Registered before the action's `await import`, as `doubleActions` is.
 */
export function doubleActionRequest({
  session = { user: { email: "vorstand@example.org" } },
}: {
  /** Who the request is signed in as, until `setSession` names another for the rest of that case; `null` for nobody. */
  session?: AdminSessionDouble;
} = {}): { setSession: (next: AdminSessionDouble, destination?: string) => void } {
  // The destination goes with the session, so a case cannot leave one standing that another case's session contradicts.
  const setSession = (next: AdminSessionDouble, destination = destinationOf(next)): void => {
    Reflect.set(globalThis, SESSION_BUS, next);
    Reflect.set(globalThis, DESTINATION_BUS, destination);
  };
  setSession(session);
  // Before every case: one reading `cacheCalls` would otherwise also read every earlier case's
  // invalidations, and one after a case that signed out would run its write with no session.
  beforeEach(() => {
    cacheCalls.length = 0;
    setSession(session);
  });
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const double = REQUEST_PACKAGES[specifier];
      return double === undefined ? nextResolve(specifier, context) : { url: asModule(double), shortCircuit: true };
    },
    load(url, context, nextLoad) {
      // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
      if (url.endsWith("/src/core/auth.ts")) return { format: "module", source: signInStore(url), shortCircuit: true };
      if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: SILENT_LOGGER, shortCircuit: true };
      return nextLoad(url, context);
    },
  });

  return { setSession };
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

let toastsRegistered = 0;

/**
 * Replaces the toast module at the module boundary, every severity recording its call.
 *
 * The real module hands its raising to HeroUI's queue rather than back to the caller.
 */
export function doubleToasts(): { raised: RaisedToast[] } {
  const raised: RaisedToast[] = [];
  // One name per call, so two doubles in one process cannot overwrite each other.
  const bus = `__flToastDouble${String((toastsRegistered += 1))}`;
  Reflect.set(globalThis, bus, raised);

  // `close` and `clear` raise nothing, and recording them would shift every index `raised` is read by.
  // `failure` keeps the site's title: the real module swaps in the neutral one, and
  // `fl_frontend/src/shared/utils/appToast.test.ts` pins that.
  const source = `const raise = (variant) => (title, options) => {
  globalThis.${bus}.push({ variant, title, description: options?.description, options });
  return String(globalThis.${bus}.length);
};
const fail = (title, failure) => raise("danger")(title, { description: failure?.unplacedError ?? failure?.error, outcome: failure?.outcome });
const inert = () => undefined;
export const UNDO_TIMEOUT_MS = 1;
export const appToast = { ${toastMembers()
    .map(
      (name) =>
        `${identifier(name)}: ${name === "close" || name === "clear" ? "inert" : name === "failure" ? "fail" : `raise(${JSON.stringify(name)})`}`,
    )
    .join(", ")} };`;

  registerHooks({
    load(url, context, nextLoad) {
      // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
      if (!url.endsWith(TOAST_MODULE)) return nextLoad(url, context);

      return { format: "module", source, shortCircuit: true };
    },
  });

  return { raised };
}
