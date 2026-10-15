import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";
import { setImmediate as settled } from "node:timers/promises";

import { doubleToasts } from "@/shared/testing/actionDoubles.ts";

import type { RaisedToast } from "@/shared/testing/actionDoubles.ts";
import type { UndoOutcome } from "./adminUndo.ts";

/* Replaced at the module boundary: the cases below press the offer's own `onPress` and read which
   toasts followed it, and the real module hands both to HeroUI's queue rather than back to its caller. */
const { raised } = doubleToasts();

// Imported here rather than at the top: a static import resolves before the hook above is registered.
const { offerUndo } = await import("./undoDispatch.ts");
const { STEP_UP_REFUSED } = await import("@/shared/components/ui/stepUp.ts");
const { EDGE_REFUSAL_BODY } = await import("./actionError.ts");
const { redirect } = await import("next/navigation");
// The class Next's action client rejects with for an action id the running build does not hold, which
// no public export constructs.
const { UnrecognizedActionError } = await import("next/dist/client/components/unrecognized-action-error.js");

/** The error Next's action client rejects a press with where the proxy turned a lapsed session away. */
const redirectRejection = (): unknown => {
  try {
    redirect("/signin");
  } catch (thrown) {
    return thrown;
  }
  return assert.fail("redirect() returned");
};

/** The ruling's words for an undo nobody can tell landed. */
const RUECKNAHME_UNKLAR = "Ob die Änderung zurückgenommen wurde, ist unklar. Lade die Seite neu und prüfe sie.";

type Pressed = { refreshed: number; toasts: RaisedToast[] };

/** Offers an undo, presses it against one answer from the action or its rejection, and reports what the press did. */
async function pressAgainst(answer: UndoOutcome | Error): Promise<Pressed> {
  let refreshed = 0;

  offerUndo({
    undo: () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)),
    fallback: "Die Spielortdaten wurden aktualisiert.",
    router: { refresh: () => void (refreshed += 1) },
  });
  raised[0]?.options?.actionProps?.onPress?.();
  await settled();

  return { refreshed, toasts: raised.slice(1) };
}

/** Every danger the press raised, by title and description. */
const dangers = (pressed: Pressed): [string, string | undefined][] =>
  pressed.toasts.filter((toast) => toast.variant === "danger").map((toast) => [toast.title, toast.description]);

describe("what the shared undo offer says when its action never answered", () => {
  beforeEach(() => {
    raised.length = 0;
  });

  /* An action whose answer never came may have restored the change on its way, so „nicht
     zurückgenommen“ would send the admin to undo by hand what may already be undone. */
  it("says nobody can tell whether a press that never answered took the change back, and reads the page again", async () => {
    const pressed = await pressAgainst(new TypeError("Failed to fetch"));

    assert.deepEqual(dangers(pressed), [["Rücknahme unklar", RUECKNAHME_UNKLAR]]);
    assert.equal(pressed.refreshed, 1, "a restore that may have landed on its way left the screen as it was");
  });

  /* The edge's own 429 never reached Next, so the change certainly stands, and the offer is gone. */
  it("says the change stands where the edge refused the press, reading nothing again", async () => {
    const pressed = await pressAgainst(new Error(EDGE_REFUSAL_BODY));

    assert.deepEqual(dangers(pressed), [["Änderung nicht zurückgenommen", "Zu viele Versuche in kurzer Zeit. Die Änderung steht weiterhin."]]);
    assert.equal(pressed.refreshed, 0, "a press that reached nothing read the page again");
  });

  /* A deploy since the page loaded retired the action the offer names, so nothing ran, and the offer is gone. */
  it("says the change stands where the running build no longer holds the action, reading nothing again", async () => {
    const pressed = await pressAgainst(new UnrecognizedActionError("Server Action not found"));

    assert.deepEqual(dangers(pressed), [
      ["Änderung nicht zurückgenommen", "Die Website wurde inzwischen aktualisiert. Lade die Seite neu. Die Änderung steht weiterhin."],
    ]);
    assert.equal(pressed.refreshed, 0, "a press that ran nothing read the page again");
  });

  /* The proxy's turn-away is Next's own redirect, which loads `/signin` as a save's does: a toast raised
     first would call an undo unclear that never ran. The redirect goes on to Next's own handler. */
  it("raises nothing and reads nothing again for Next's own redirect, handing it on", async () => {
    const handedOn: unknown[] = [];
    const listener = (reason: unknown) => void handedOn.push(reason);
    // The browser hands a rejection nobody awaits to Next's own listener; the runner's would fail the case
    // on it, so they stand aside while this one catches it.
    const runners = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    process.on("unhandledRejection", listener);
    try {
      const rejection = redirectRejection();
      const pressed = await pressAgainst(rejection as Error);
      await settled();

      assert.deepEqual(dangers(pressed), [], "the redirect was answered with a toast");
      assert.equal(pressed.refreshed, 0, "the redirect read the page again");
      assert.deepEqual(handedOn, [rejection], "the redirect stopped short of Next's own handler");
    } finally {
      process.off("unhandledRejection", listener);
      for (const runner of runners) process.on("unhandledRejection", runner);
    }
  });

  /* The browser's one path into the log is the crash report (`docs/logging/spec.md` §1.3); a `console`
     call from here lands outside the envelope. */
  it("writes nothing to the console when the action rejects", async () => {
    const written: string[] = [];
    for (const channel of ["log", "info", "warn", "error"] as const)
      mock.method(console, channel, (...parts: unknown[]) => void written.push(`${channel} ${parts.map(String).join(" ")}`));
    try {
      await pressAgainst(new TypeError("Failed to fetch"));
    } finally {
      mock.restoreAll();
    }

    assert.deepEqual(written, []);
  });
});

describe("what the shared undo offer says of its action's answer", () => {
  beforeEach(() => {
    raised.length = 0;
  });

  /* A restore whose write went unacknowledged may stand, so neither title fits it but the unclear one,
     and the action's sentence under it names what to check. */
  it("titles a replay of unknown outcome unclear, under the action's own sentence", async () => {
    const error = "Die Rücknahme wurde abgebrochen. Prüfe die Spielortdaten.";
    const pressed = await pressAgainst({ success: false, error, outcome: "unknown" });

    assert.deepEqual(dangers(pressed), [["Rücknahme unklar", error]]);
    // The action read the page again itself, wherever its replay wrote.
    assert.equal(pressed.refreshed, 0);
  });

  /* A half went back, so neither „nicht zurückgenommen“ nor „zurückgenommen“ is true of it (`docs/frontend/spec.md :: I42`). */
  it("titles a replay that put one half back partly restored, under the action's sentence", async () => {
    const error = "Die Saison passt nicht mehr. Nur die Stammdaten wurden zurückgesetzt.";
    const pressed = await pressAgainst({ success: false, error, outcome: "partial" });

    assert.deepEqual(dangers(pressed), [["Nur teilweise zurückgenommen", error]]);
  });

  it("keeps a refused replay under the negated title, with the action's sentence", async () => {
    const pressed = await pressAgainst({ success: false, error: "Der Spielort wurde inzwischen gelöscht. Die Änderung steht weiterhin." });

    assert.deepEqual(dangers(pressed), [
      ["Änderung nicht zurückgenommen", "Der Spielort wurde inzwischen gelöscht. Die Änderung steht weiterhin."],
    ]);
  });

  /* One outcome per title: a restore that cost something is not a clean one (`docs/frontend/spec.md :: I42`). */
  it("grades a restore by what it cost, title and colour together", async () => {
    const clean = await pressAgainst({ success: true, message: "Die Änderung wurde zurückgenommen.", warn: false });
    raised.length = 0;
    const costly = await pressAgainst({ success: true, message: "Die Änderung wurde zurückgenommen. Ein Link ging raus.", warn: true });

    assert.deepEqual(
      [...clean.toasts, ...costly.toasts].filter((toast) => toast.variant !== "pending").map((toast) => [toast.variant, toast.title]),
      [
        ["success", "Änderung zurückgenommen"],
        ["warning", "Mit Folgen zurückgenommen"],
      ],
    );
  });
});

describe("an undo whose replay is a step-up write", () => {
  beforeEach(() => {
    raised.length = 0;
  });

  /** Offers an undo under a page past the window, presses it, and reports the prompts and the dispatches. */
  async function pressStale(answer: boolean): Promise<{ prompts: number; dispatched: number }> {
    let prompts = 0;
    let dispatched = 0;

    offerUndo({
      undo: () => {
        dispatched += 1;
        return Promise.resolve({ success: true, message: "Die Änderung wurde zurückgenommen.", warn: false });
      },
      fallback: "Die Kontakte wurden aktualisiert.",
      stepUp: {
        isStale: () => true,
        confirm: () => {
          prompts += 1;
          return Promise.resolve(answer);
        },
      },
      router: { refresh: () => undefined },
    });
    raised[0]?.options?.actionProps?.onPress?.();
    await settled();
    await settled();

    return { prompts, dispatched };
  }

  /* `docs/frontend/spec.md :: I431`: the offer outlives the page's tree, so it asks through the page
     it was offered under, and the action refuses the replay from a stale session whatever it asked. */
  it("asks for the passkey before it dispatches", async () => {
    assert.deepEqual(await pressStale(true), { prompts: 1, dispatched: 1 });
  });

  it("dispatches nothing on a refused prompt, and says why", async () => {
    assert.deepEqual(await pressStale(false), { prompts: 1, dispatched: 0 });
    assert.deepEqual(
      raised.slice(1).map((toast) => [toast.variant, toast.title, toast.description]),
      [["danger", "Änderung nicht zurückgenommen", STEP_UP_REFUSED]],
    );
  });
});
