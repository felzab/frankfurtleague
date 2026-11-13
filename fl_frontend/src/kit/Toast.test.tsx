// @vitest-environment jsdom
import { compiledGlobals, selectorsOf } from "@/test-support/stylesheet.ts";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { appToast, toastAnswer, ToastRegion } from "./Toast";

const TITLE = COPY.shared.toast.failure;

const compiled = compiledGlobals();

// The queue is the module's own, shared by every test here: each toast leaves before the next test, a done act's on
// the timer its region started and any other by its close button, pressed while the test's region still stands.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const close of screen.queryAllByRole("button", { name: COPY.shared.close })) if (close.isConnected) act(() => close.click());
  act(() => vi.runAllTimers());
  vi.useRealTimers();
});

/** The region a drawn toast stands in. */
function regionOf(toast: HTMLElement): HTMLElement {
  const region = toast.closest<HTMLElement>("[data-react-aria-top-layer]");
  if (region === null) throw new Error("the toast stands in no region");
  return region;
}

describe("the toast region", () => {
  // A navigation from one frame to the other mounts the other frame's region while a toast is still showing.
  it("draws a toast raised before its region mounts", () => {
    act(() => appToast("danger", TITLE));
    render(<ToastRegion frame="classic" />);

    expect(screen.getByText(TITLE)).toBeTruthy();
  });

  // React Aria draws the region in the document's body, outside either frame: a measure that places it
  // declared on a frame alone is undefined there, and the toast falls below the screen, which nothing reports.
  it("is placed by measures the root declares", async () => {
    render(
      <>
        <ToastRegion frame="rail" />
        <ToastRegion frame="classic" />
      </>,
    );
    act(() => appToast("danger", TITLE));
    const classes = new Set(screen.getAllByText(TITLE).flatMap((toast) => [...regionOf(toast).classList]));

    const stylesheet = await compiled;
    const onRoot = new Set<string>();
    const read = new Set<string>();
    stylesheet.walkDecls((decl) => {
      if (decl.parent?.type !== "rule") return;
      const selectors = selectorsOf(decl.parent).map((selector) => selector.replace(/\\(.)/g, "$1"));
      if (selectors.some((selector) => selector.split(",").some((part) => part.trim() === ":root"))) onRoot.add(decl.prop);
      if (!selectors.some((selector) => [...classes].some((name) => selector.includes(`.${name}`)))) return;
      // A `var()` with no fallback is the one that leaves its property invalid where the name is undefined.
      for (const [, name] of decl.value.matchAll(/var\((--[\w-]+)\)/g)) read.add(name!);
    });

    expect(read.size).toBeGreaterThan(0);
    expect([...read].filter((name) => !onRoot.has(name))).toStrictEqual([]);
  });
});

// The harm: an act that partly happened told as done or as refused, the person left to think it did all or nothing.
describe("an act's answer as its toast", () => {
  it.each([
    ["done", { ok: true, value: undefined }, COPY.shared.toast.agreed, "text-success"],
    ["partly done", { ok: true, value: undefined, note: COPY.shared.toast.copied, warn: true }, COPY.shared.toast.copied, "text-warn"],
    ["partly refused", { ok: false, reason: COPY.shared.failure.stale, warn: true }, COPY.shared.failure.stale, "text-warn"],
    ["refused", { ok: false, reason: COPY.shared.failure.stale }, COPY.shared.failure.stale, "text-danger"],
  ] as const)("says %s in its own tone", (_case, answer, title, hue) => {
    render(<ToastRegion frame="rail" />);

    act(() => toastAnswer(answer, COPY.shared.toast.agreed));

    const toast = screen.getByText(title).closest<HTMLElement>("[data-kit-focus='ring']");
    expect(toast?.querySelector(`.${hue}`)).toBeTruthy();
  });

  // The harm: a refusal gone before its person read it, the toast being the one place it is said.
  it("lets a done act's toast leave by itself and keeps a refusal until it is closed", () => {
    render(<ToastRegion frame="rail" />);
    act(() => {
      toastAnswer({ ok: true, value: undefined }, COPY.shared.toast.agreed);
      toastAnswer({ ok: false, reason: COPY.shared.failure.stale }, COPY.shared.toast.agreed);
    });

    act(() => vi.runAllTimers());

    expect(screen.queryByText(COPY.shared.toast.agreed)).toBeNull();
    expect(screen.getByText(COPY.shared.failure.stale)).toBeTruthy();

    act(() => screen.getByRole("button", { name: COPY.shared.close }).click());

    expect(screen.queryByText(COPY.shared.failure.stale)).toBeNull();
  });
});
