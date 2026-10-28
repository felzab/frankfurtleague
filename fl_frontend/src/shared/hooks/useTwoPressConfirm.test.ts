import { afterAll, assert, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { StepUp, StepUpDemand } from "@/shared/components/ui/stepUp.ts";
// Type-only, so nothing is imported at load: the hook module is pulled in from `beforeAll`, below.
import type * as ReactModule from "react";
import type { useTwoPressConfirm } from "./useTwoPressConfirm.ts";

/** The `useState` cells, by call order, held across the presses of a test the way a mounted component holds them. */
let cells: { value: unknown }[] = [];
let stateCalls = 0;
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
function useState<T>(initial: T | (() => T)): [T, (next: T) => void] {
  const cell = (cells[stateCalls] ??= { value: typeof initial === "function" ? (initial as () => T)() : initial });
  stateCalls += 1;
  // The setter writes the cell and re-renders nothing: a later `render()` reads it back, which is
  // React's own sequence and what makes two presses two separate reads of the armed state.
  return [cell.value as T, (next: T) => void (cell.value = next)];
}

function useRef<T>(initial: T): { current: T } {
  const box = (refBoxes[refCalls] ??= { current: initial });
  refCalls += 1;
  return box as { current: T };
}

/** What the page's step-up provider hands the hook, `undefined` standing for a page without one. */
let stepUpContext: StepUp | undefined;

function useContext(): StepUp | undefined {
  return stepUpContext;
}

function useTransition(): [boolean, (scope: () => void) => void] {
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

type Control = ReturnType<typeof useTwoPressConfirm>;

/* Loaded from `beforeAll`, never at the top level: React is stood in for by the four hooks above,
   which `vi.doMock` hands only to modules imported after it. Renamed off `use`, which is the whole of
   what `react-hooks/rules-of-hooks` grades a call site by. */
let twoPressConfirm!: typeof useTwoPressConfirm;
/** The hook's own threshold, so these tests move with it rather than pinning a copy. */
let DOUBLE_PRESS_MS!: number;

beforeAll(async () => {
  // `createContext` and the rest stay React's own: `stepUp.ts` builds its context with it.
  vi.doMock("react", async (importOriginal) => ({
    ...(await importOriginal<typeof ReactModule>()),
    useState,
    useRef,
    useContext,
    useTransition,
  }));
  const hookModule = await import("./useTwoPressConfirm.ts");
  twoPressConfirm = hookModule.useTwoPressConfirm;
  DOUBLE_PRESS_MS = hookModule.DOUBLE_PRESS_MS;
  Date.now = () => now;
});

afterAll(() => {
  Date.now = realNow;
});

/** One render pass. React reads the cell fresh on each, and so does the stub above. */
const render = (guard?: () => boolean, stepUp?: StepUpDemand): Control => {
  refCalls = 0;
  stateCalls = 0;
  return twoPressConfirm({ guard, stepUp });
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
    cells = [];
    inFlight = false;
    refBoxes = [];
    refreshHeld = undefined;
    now = 0;
    stepUpContext = undefined;
  });

  /* Drop the arming branch's `return` and the FIRST press writes — the whole confirmation gone from
     every arming panel at once, with the alert never rendered. */
  it("arms on the first press and writes nothing", () => {
    const gate = gated();

    render().press(gate.write);

    expect(gate.calls(), "the first press wrote").toBe(0);
    expect(render().isConfirming, "the first press did not arm the control").toBe(true);
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

    expect(gate.calls(), "the pair of presses did not send exactly one write").toBe(1);
  });

  /* A genuine double-click is two presses to React — a re-render sits between the clicks — so the
     second one arrives armed before the alert was readable. Drop the interval check and it writes. */
  it("ignores a confirming press inside the double-press window and stays armed", async () => {
    const gate = gated();

    render().press(gate.write);
    wait(DOUBLE_PRESS_MS - 1);
    render().press(gate.write);
    await settled();

    expect(gate.calls(), "a double-click satisfied the confirmation").toBe(0);
    expect(render().isConfirming, "the ignored press disarmed the control").toBe(true);
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

    expect(gate.calls(), "the press after the ignored one did not confirm").toBe(1);
  });

  /* A refused guard leaves the control as it found it. Drop the refusal branch's `return` and the
     press arms instead: the toast says the draft is unsaved and the control offers the write anyway. */
  it("neither writes nor arms when the guard refuses the first press", () => {
    const gate = gated();

    render(() => false).press(gate.write);

    expect(gate.calls(), "a refused guard let the write through").toBe(0);
    expect(render().isConfirming, "a refused guard armed the control").toBe(false);
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

    expect(gate.calls(), "a draft typed after arming was written over").toBe(0);
    expect(render().isConfirming, "the refusal left the alert standing over a write it refuses again").toBe(false);
  });

  /* The open alert, the destructive fill and the closed cancel are what say a press is in flight,
     and clearing the armed state before the response drops all three at once. */
  it("holds the armed state and reports the write until it answers", async () => {
    const gate = gated();

    render().press(gate.write);
    wait(DOUBLE_PRESS_MS);
    render().press(gate.write);

    const during = render();
    expect(during.isConfirming, "the armed state dropped while the write was in flight").toBe(true);
    expect(during.isPending, "the control does not report its own write in flight").toBe(true);

    gate.finish();
    await settled();

    const after = render();
    expect(after.isConfirming, "the answered write left the control armed").toBe(false);
    expect(after.isPending, "the answered write left the control reporting a request").toBe(false);
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

    expect(gate.calls(), "a second press before the next render sent the write again").toBe(1);
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

    expect(gate.calls(), "a press during the refresh sent the write again").toBe(1);
  });

  /* The cancel stands beside a running write, and disarming there drops the alert over a write
     already sent. */
  it("stays armed on a cancel while the write is in flight", async () => {
    const gate = gated();

    render().press(gate.write);
    wait(DOUBLE_PRESS_MS);
    render().press(gate.write);
    render().cancel();

    expect(render().isConfirming, "a cancel mid-write disarmed the control").toBe(true);
    gate.finish();
    await settled();
  });

  /* „Abbrechen“ is offered only while armed, so what it has to do is put the control back where the
     first press found it. */
  it("disarms on cancel", () => {
    const gate = gated();

    render().press(gate.write);
    render().cancel();

    expect(render().isConfirming, "cancel left the control armed").toBe(false);
    expect(gate.calls(), "cancel wrote").toBe(0);
  });
});

/** The page's step-up, stale until `until` on the test's clock, its prompt answering `outcome` and counting each run. */
function stepUpUntil(until: number, outcome = true): { prompts: () => number } {
  let prompts = 0;
  stepUpContext = {
    isStale: (at) => at >= until,
    confirm: () => {
      prompts += 1;
      return Promise.resolve(outcome);
    },
  };
  return { prompts: () => prompts };
}

describe("the two-press confirm of a step-up write", () => {
  beforeEach(() => {
    cells = [];
    inFlight = false;
    refBoxes = [];
    refreshHeld = undefined;
    now = 0;
    stepUpContext = undefined;
  });

  /* The label the armed press wears is the page's promise about that press; drop the arming's read of
     the window and every step-up write arms on its own words with the prompt still to come. */
  it("arms asking for the passkey past the window, and on its own words inside it", () => {
    stepUpUntil(0);
    render(undefined, true).press(() => Promise.resolve());
    expect(render(undefined, true).asksPasskey, "a stale session armed without asking for the passkey").toBe(true);

    cells = [];
    stepUpUntil(1);
    render(undefined, true).press(() => Promise.resolve());
    expect(render(undefined, true).asksPasskey, "a confirmed session was asked for the passkey").toBe(false);
  });

  /* The prompt comes before the write, inside the press: a write sent first is refused by the server,
     and a prompt started anywhere else has lost the press's user activation. */
  it("runs the prompt on the armed press and then sends the write once", async () => {
    const stepUp = stepUpUntil(0);
    const gate = gated();

    render(undefined, true).press(gate.write);
    wait(DOUBLE_PRESS_MS);
    render(undefined, true).press(gate.write);
    await settled();
    gate.finish();
    await settled();

    expect(stepUp.prompts(), "the armed press sent the write without the prompt").toBe(1);
    expect(gate.calls(), "a confirmed prompt did not send exactly one write").toBe(1);
    expect(render(undefined, true).isConfirming, "the answered write left the control armed").toBe(false);
  });

  /* A refused prompt sends nothing, says so beside the control, and leaves it armed on the prompt's
     label, so the next press asks again rather than arming afresh. */
  it("sends nothing on a refused prompt and stays armed to ask again", async () => {
    const stepUp = stepUpUntil(0, false);
    const gate = gated();

    render(undefined, true).press(gate.write);
    wait(DOUBLE_PRESS_MS);
    render(undefined, true).press(gate.write);
    await settled();

    const refused = render(undefined, true);
    expect(gate.calls(), "a refused prompt sent the write").toBe(0);
    expect(stepUp.prompts()).toBe(1);
    expect(
      [refused.isConfirming, refused.asksPasskey, refused.passkeyRefused],
      "a refused prompt left the control anywhere but armed on the prompt, saying it was refused",
    ).toStrictEqual([true, true, true]);

    refused.press(gate.write);
    await settled();
    expect(stepUp.prompts(), "the press after a refusal did not ask again").toBe(2);
  });

  /* The window can close while the alert stands. The label then still says the write's own words, and
     the press runs the prompt anyway rather than sending what the server refuses. */
  it("asks at the armed press when the window closed after arming", async () => {
    const stepUp = stepUpUntil(DOUBLE_PRESS_MS);
    const gate = gated();

    render(undefined, true).press(gate.write);
    expect(render(undefined, true).asksPasskey).toBe(false);
    wait(DOUBLE_PRESS_MS);
    render(undefined, true).press(gate.write);
    await settled();
    gate.finish();
    await settled();

    expect(stepUp.prompts(), "a press after the window closed sent the write unconfirmed").toBe(1);
    expect(gate.calls()).toBe(1);
  });

  /* A panel can learn its demand from a read its arming started, as the erasure learns a grant holder's address:
     a label fixed on the demand declared at arming says the write's own words over a press that prompts. */
  it("re-decides the passkey label when the declared demand changes while armed", () => {
    stepUpContext = { isStale: (_at, demand) => demand === "enrolment", confirm: () => Promise.resolve(true) };

    render(undefined, true).press(() => Promise.resolve());
    expect(render(undefined, true).asksPasskey, "a session inside the step-up's window was asked for the passkey").toBe(false);
    expect(render(undefined, "enrolment").asksPasskey, "a demand declared after arming left the label on the write's words").toBe(true);
  });

  /* The declaration is the site's: a reversible two-press write, and the sign-out, never ask, whatever
     the page's window says. */
  it("never asks for a control that does not declare the step-up", async () => {
    const stepUp = stepUpUntil(0);
    const gate = gated();

    render().press(gate.write);
    expect(render().asksPasskey, "an undeclared control armed on the prompt").toBe(false);
    wait(DOUBLE_PRESS_MS);
    render().press(gate.write);
    gate.finish();
    await settled();

    expect(stepUp.prompts(), "an undeclared control ran the prompt").toBe(0);
    expect(gate.calls()).toBe(1);
  });

  /* Outside the administrator's shell there is no figure to ask on; the write goes, and the server's
     refusal is the whole of the step-up there. */
  it("sends without asking where no page provides a step-up", async () => {
    const gate = gated();

    render(undefined, true).press(gate.write);
    expect(render(undefined, true).asksPasskey).toBe(false);
    wait(DOUBLE_PRESS_MS);
    render(undefined, true).press(gate.write);
    gate.finish();
    await settled();

    expect(gate.calls()).toBe(1);
  });
});
