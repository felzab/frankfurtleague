import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { beforeEach } from "node:test";
import { fileURLToPath } from "node:url";

import { blankComments } from "@/core/blankComments.ts";

/** One write a component sent: the action's exported name, and the payload it was handed. */
export type ActionCall = { action: string; payload: unknown };

type Recorder = { push: (call: ActionCall) => void; answer: () => Promise<unknown> };

let registered = 0;

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
}): { calls: ActionCall[]; answerWith: (next: () => Promise<unknown>) => void } {
  const calls: ActionCall[] = [];
  let answering = answer;
  // Back to `answer` before every case: a case that named another answer and never restored it
  // would otherwise hand that answer to the next case's write, which then passes on it.
  beforeEach(() => {
    answering = answer;
  });
  // Through the global rather than a closure: the replaced module is compiled from source and shares
  // nothing with this scope. One name per call, so two doubles in one process cannot overwrite each other.
  const bus = `__flActionDouble${String((registered += 1))}`;
  const recorder: Recorder = { push: (call) => calls.push(call), answer: () => answering() };
  Reflect.set(globalThis, bus, recorder);

  // Registered as this call evaluates, so it stands above the caller's own `await import` of the component,
  // whose graph reaches the real module.
  registerHooks({
    load(url, context, nextLoad) {
      if (!modules.some((named) => (typeof named === "string" ? url.endsWith(named) : named.test(url)))) return nextLoad(url, context);

      const source = [...readFileSync(fileURLToPath(url), "utf8").matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)]
        .map(
          ([, name]) =>
            `export const ${name ?? ""} = async (payload) => { const bus = globalThis.${bus}; bus.push({ action: "${name ?? ""}", payload }); return bus.answer(); };`,
        )
        .join("\n");

      return { format: "module", source, shortCircuit: true };
    },
  });

  return { calls, answerWith: (next) => void (answering = next) };
}

/**
 * Every slice's actions module, for a suite in which no case saves: a real write module loads the
 * sign-in store and its database driver into the render, which is most of such a suite's time.
 */
export function doubleEveryAction(): ReturnType<typeof doubleActions> {
  return doubleActions({ modules: [/\/src\/features\/\w+\/actions\.ts$/] });
}

const asModule = (source: string): string => `data:text/javascript,${encodeURIComponent(source)}`;

/**
 * Each answers only inside a request Next itself is serving: `updateTag`, `refresh` and `headers`
 * throw outside one, and `server-only` throws outside a server build.
 */
const REQUEST_PACKAGES: Readonly<Record<string, string>> = {
  "server-only": "export {};",
  "next/cache":
    "const inert = () => undefined; export { inert as updateTag, inert as refresh, inert as revalidateTag, inert as revalidatePath };",
  "next/headers": "export const headers = async () => new Headers();",
};

/** Every refusal an action logs would otherwise reach the run's output as an error line. */
const SILENT_LOGGER = "const inert = () => undefined; export const logger = { debug: inert, info: inert, warn: inert, error: inert };";

/**
 * The sign-in store with an administrator signed in, the real one opening the database driver as it
 * loads. Every other export throws where called, its name read off the real module so an import links.
 */
function signedInStore(url: string): string {
  return [...readFileSync(fileURLToPath(url), "utf8").matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)]
    .map(([, name]) =>
      name === "getAdminSession"
        ? `export const getAdminSession = async () => ({ user: { email: "vorstand@example.org" } });`
        : `export const ${name ?? ""} = () => { throw new Error("the sign-in store's ${name ?? ""} is not doubled"); };`,
    )
    .join("\n");
}

/**
 * The request a server action runs in, so a case calls the REAL action, its `mutations.ts` doubled
 * through `doubleActions`. Registered before the action's `await import`, as `doubleActions` is.
 */
export function doubleActionRequest(): void {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      // The real module, which `runAdminMutation` rethrows a navigation through: `next` publishes no
      // `exports` map, so Node finds the subpath only with the extension a bundler would supply.
      if (specifier === "next/navigation") return nextResolve("next/navigation.js", context);

      const double = REQUEST_PACKAGES[specifier];
      return double === undefined ? nextResolve(specifier, context) : { url: asModule(double), shortCircuit: true };
    },
    load(url, context, nextLoad) {
      // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
      if (url.endsWith("/src/core/auth.ts")) return { format: "module", source: signedInStore(url), shortCircuit: true };
      if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: SILENT_LOGGER, shortCircuit: true };
      return nextLoad(url, context);
    },
  });
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
  const source = blankComments(readFileSync(path.resolve(import.meta.dirname, "..", "utils", "appToast.ts"), "utf8"));
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
    .map((name) => `${name}: ${name === "close" || name === "clear" ? "inert" : name === "failure" ? "fail" : `raise("${name}")`}`)
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
