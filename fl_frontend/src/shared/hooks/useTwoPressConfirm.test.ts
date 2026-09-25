import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, before, beforeEach, describe, it } from "node:test";

// Type-only, so nothing is imported at load: the hook module is pulled in from `before`, below.
import type { useTwoPressConfirm } from "./useTwoPressConfirm.ts";

/** The one `useState` cell, held across the presses of a test the way a mounted component holds it. */
let cell: unknown;
let cellFilled = false;
let inFlight = false;
/** The `useRef` boxes, by call order, held across renders the same way. */
let refBoxes: { current: unknown }[] = [];
let refCalls = 0;
/** A refresh the write started, which React holds the transition pending for after the write answers. */
let refreshHeld: Promise<void> | undefined;

/**
 * The renderer, in the two hooks `press` actually needs. It is DRIVEN rather than read here because a
 * source-order assertion is satisfied by an arming branch that no longer exits.
 */
export function useState<T>(initial: T | (() => T)): [T, (next: T) => void] {
  if (!cellFilled) {
    cell = typeof initial === "function" ? (initial as () => T)() : initial;
    cellFilled = true;
  }
  // The setter writes the cell and re-renders nothing: a later `render()` reads it back, which is
  // React's own sequence and what makes two presses two separate reads of the armed state.
  return [cell as T, (next: T) => void (cell = next)];
}

export function useRef<T>(initial: T): { current: T } {
  const box = (refBoxes[refCalls] ??= { current: initial });
  refCalls += 1;
  return box as { current: T };
}

export function useTransition(): [boolean, (scope: () => void) => void] {
  return [
    inFlight,
    (scope) => {
      inFlight = true;
      void Promise.resolve(scope() as unknown)
        .then(() => refreshHeld)
        .finally(() => (inFlight = false));
    },
  ];
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Narrowed to the file under test, so nothing else loaded in this process loses React.
    if (specifier === "react" && context.parentURL !== undefined && context.parentURL.endsWith("/useTwoPressConfirm.ts")) {
      return { url: import.meta.url, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

type Control = ReturnType<typeof useTwoPressConfirm>;

/* Loaded from `before`, never at the top level: the hook's `react` import resolves back into THIS
   module, and a top-level await would still be running. Renamed off `use`, which is the whole of what
   `react-hooks/rules-of-hooks` grades a call site by. */
let twoPressConfirm!: typeof useTwoPressConfirm;
/** The hook's own threshold, so these tests move with it rather than pinning a copy. */
let DOUBLE_PRESS_MS!: number;

before(async () => {
  const hookModule = await import("./useTwoPressConfirm.ts");
  twoPressConfirm = hookModule.useTwoPressConfirm;
  DOUBLE_PRESS_MS = hookModule.DOUBLE_PRESS_MS;
  Date.now = () => now;
});

after(() => {
  Date.now = realNow;
});

/** One render pass. React reads the cell fresh on each, and so does the stub above. */
const render = (guard?: () => boolean): Control => {
  refCalls = 0;
  return twoPressConfirm(guard);
};

/** One turn of the loop — long enough for a settled write's continuation to have run. */
const settled = (): Promise<void> => new Promise<void>((resolve) => void setTimeout(resolve, 0));

/* The hook measures the arming-to-confirming distance through `Date.now`, so the clock is script
   rather than wall: a test that slept through the real interval would prove only its own patience. */
const realNow = Date.now;
let now = 0;

/** What a person does between reading the alert and pressing again, as the clock sees it. */
const wait = (ms: number): void => void (now += ms);

/** A write the test finishes by hand, so an assertion can stand while the request is in flight. */
function gated(): { write: () => Promise<void>; finish: () => void; calls: () => number } {
  let calls = 0;
  let finish = (): void => {};
  const answered = new Promise<void>((resolve) => (finish = resolve));

  return {
    write: () => {
      calls += 1;
      return answered;
    },
    finish: () => finish(),
    calls: () => calls,
  };
}

describe("the two-press confirm", () => {
  beforeEach(() => {
    cellFilled = false;
    inFlight = false;
    refBoxes = [];
    refreshHeld = undefined;
    now = 0;
  });

  /* Drop the arming branch's `return` and the FIRST press writes — the whole confirmation gone from
     every arming panel at once, with the alert never rendered. */
  it("arms on the first press and writes nothing", () => {
    const gate = gated();

    render().press(gate.write);

    assert.equal(gate.calls(), 0, "the first press wrote");
    assert.equal(render().isConfirming, true, "the first press did not arm the control");
  });

  /* The second press, and exactly one write out of the pair. A press that armed and wrote would
     report two here. */
  it("writes exactly once on the second press", async () => {
    const gate = gated();

    render().press(gate.write);
    wait(DOUBLE_PRESS_MS);
    render().press(gate.write);
    gate.finish();
    await settled();

    assert.equal(gate.calls(), 1, "the pair of presses did not send exactly one write");
  });

  /* A genuine double-click is two presses to React — a re-render sits between the clicks — so the
     second one arrives armed before the alert was readable. Drop the interval check and it writes. */
  it("ignores a confirming press inside the double-press window and stays armed", async () => {
    const gate = gated();

    render().press(gate.write);
    wait(DOUBLE_PRESS_MS - 1);
    render().press(gate.write);
    await settled();

    assert.equal(gate.calls(), 0, "a double-click satisfied the confirmation");
    assert.equal(render().isConfirming, true, "the ignored press disarmed the control");
  });

  /* Ignored, not swallowed: the window is measured from the ARMING press, so a deliberate press
     after an ignored one needs no fresh arming — the alert never left the screen. */
  it("confirms on a press past the window even after one inside it was ignored", async () => {
    const gate = gated();

    render().press(gate.write);
    wait(DOUBLE_PRESS_MS - 1);
    render().press(gate.write);
    wait(1);
    render().press(gate.write);
    gate.finish();
    await settled();

    assert.equal(gate.calls(), 1, "the press after the ignored one did not confirm");
  });

  /* A refused guard leaves the control as it found it. Drop the refusal branch's `return` and the
     press arms instead: the toast says the draft is unsaved and the control offers the write anyway. */
  it("neither writes nor arms when the guard refuses the first press", () => {
    const gate = gated();

    render(() => false).press(gate.write);

    assert.equal(gate.calls(), 0, "a refused guard let the write through");
    assert.equal(render().isConfirming, false, "a refused guard armed the control");
  });

  /* The guard's second run, which is the whole of why it stands ahead of the arming branch: the
     editor's fields stay live between the presses, so a draft typed in that window has to refuse
     the write. Guard the arming press alone and this press sends it. */
  it("refuses the write when the guard turns down the confirming press", async () => {
    const gate = gated();
    let allowed = true;
    const guard = (): boolean => allowed;

    render(guard).press(gate.write);
    wait(DOUBLE_PRESS_MS);
    allowed = false;
    render(guard).press(gate.write);
    await settled();

    assert.equal(gate.calls(), 0, "a draft typed after arming was written over");
    assert.equal(render().isConfirming, false, "the refusal left the alert standing over a write it refuses again");
  });

  /* The open alert, the destructive fill and the closed cancel are what say a press is in flight,
     and clearing the armed state before the response drops all three at once. */
  it("holds the armed state and reports the write until it answers", async () => {
    const gate = gated();

    render().press(gate.write);
    wait(DOUBLE_PRESS_MS);
    render().press(gate.write);

    const during = render();
    assert.equal(during.isConfirming, true, "the armed state dropped while the write was in flight");
    assert.equal(during.isPending, true, "the control does not report its own write in flight");

    gate.finish();
    await settled();

    const after = render();
    assert.equal(after.isConfirming, false, "the answered write left the control armed");
    assert.equal(after.isPending, false, "the answered write left the control reporting a request");
  });

  /* A press in the same render that confirmed, before React has reported the write: the one the
     transition's own flag cannot see yet. */
  it("sends no second write for a press landing before the write is reported", async () => {
    const gate = gated();

    render().press(gate.write);
    wait(DOUBLE_PRESS_MS);
    const confirming = render();
    confirming.press(gate.write);
    wait(DOUBLE_PRESS_MS);
    confirming.press(gate.write);
    gate.finish();
    await settled();

    assert.equal(gate.calls(), 1, "a second press before the next render sent the write again");
  });

  /* The write has answered while the refresh it started holds the transition: React defers the
     disarming with it, so every render in that window reads armed and pending, and this press is
     made from one. */
  it("sends no second write for a press while the write's refresh still holds the control", async () => {
    const gate = gated();
    let landRefresh = (): void => {};
    refreshHeld = new Promise<void>((resolve) => (landRefresh = resolve));

    render().press(gate.write);
    wait(DOUBLE_PRESS_MS);
    render().press(gate.write);
    const holding = render();
    assert.ok(holding.isConfirming && holding.isPending, "the sample never reached an armed render with the write in flight");
    gate.finish();
    await settled();

    wait(DOUBLE_PRESS_MS);
    holding.press(gate.write);
    landRefresh();
    await settled();

    assert.equal(gate.calls(), 1, "a press during the refresh sent the write again");
  });

  /* The cancel stands beside a running write, and disarming there drops the alert over a write
     already sent. */
  it("stays armed on a cancel while the write is in flight", async () => {
    const gate = gated();

    render().press(gate.write);
    wait(DOUBLE_PRESS_MS);
    render().press(gate.write);
    render().cancel();

    assert.equal(render().isConfirming, true, "a cancel mid-write disarmed the control");
    gate.finish();
    await settled();
  });

  /* „Abbrechen“ is offered only while armed, so what it has to do is put the control back where the
     first press found it. */
  it("disarms on cancel", () => {
    const gate = gated();

    render().press(gate.write);
    render().cancel();

    assert.equal(render().isConfirming, false, "cancel left the control armed");
    assert.equal(gate.calls(), 0, "cancel wrote");
  });
});
