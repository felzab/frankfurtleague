import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

/** One write a component sent: the action's exported name, and the payload it was handed. */
export type ActionCall = { action: string; payload: unknown };

type Recorder = { push: (call: ActionCall) => void; answer: () => Promise<unknown> };

let registered = 0;

/**
 * Replaces an actions module at the module boundary, every export it declares answering `answer` and
 * recording its call: a real write needs a session and a backend, and a test-only prop would be a seam in
 * production code.
 */
export function doubleActions({
  modules,
  answer = () => Promise.resolve({ success: true, message: "Gespeichert." }),
}: {
  /** Each actions module to replace, matched against the RESOLVED url: a path tail, or a pattern over one. */
  modules: readonly (string | RegExp)[];
  /** What every replaced write answers, until `answerWith` names another. */
  answer?: () => Promise<unknown>;
}): { calls: ActionCall[]; answerWith: (next: () => Promise<unknown>) => void } {
  const calls: ActionCall[] = [];
  let answering = answer;
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
