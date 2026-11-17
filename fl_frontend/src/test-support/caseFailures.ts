import { afterEach, expect, it } from "vitest";

/** A case `body` that must fail, and the case after it, which reads that failure for `named`. */
type FailsNaming = (name: string, named: RegExp, body: () => Promise<void> | void) => void;

/**
 * The self-tests' way to hold a fault a helper must raise. Each case's failure messages are recorded once every hook
 * of the case has run, its `onTestFinished` callbacks included, since a fault the network or the capture finds in its
 * own hook fails the case only there: Vitest runs `onTestFailed` after all of them, and before `it.fails` turns the
 * failure into a pass. A faulting case is declared `it.fails`, so it is red where the fault no longer fails it. Called
 * at a file's top level, so the file registers the hook for its own cases.
 */
export function caseFailures(): { failsNaming: FailsNaming } {
  const failures = new Map<string, string>();
  afterEach(({ task, onTestFailed: failed }) => {
    failed(() => {
      failures.set(task.name, (task.result?.errors ?? []).map(({ message }) => String(message)).join("\n"));
    });
  });

  return {
    failsNaming: (name, named, body) => {
      it.fails(name, body);
      it(`${name}: the failure names it`, () => {
        expect(failures.get(name)).toMatch(named);
      });
    },
  };
}
