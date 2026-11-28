// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy/shared";

import { appToast, toastAnswer, ToastRegion } from "./Toast";

const TITLE = COPY.shared.failure.unexpected;

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

describe("the toast region", () => {
  // A navigation from one frame to the other mounts the other frame's region while a toast is still showing.
  it("draws a toast raised before its region mounts", () => {
    act(() => appToast("danger", TITLE));
    render(<ToastRegion frame="classic" />);

    expect(screen.getByText(TITLE)).toBeTruthy();
  });
});

// The harm: an act that partly happened told as done or as refused, the person left to think it did all or nothing.
describe("an act's answer as its toast", () => {
  it.each([
    ["done", { ok: true, value: undefined }, COPY.shared.state.agreed, "text-success"],
    [
      "partly done",
      { ok: true, value: undefined, note: COPY.shared.addressChange.previousStays, warn: true },
      COPY.shared.addressChange.previousStays,
      "text-warn",
    ],
    ["refused", { ok: false, reason: COPY.shared.failure.stale }, COPY.shared.failure.stale, "text-danger"],
  ] as const)("says %s in its own tone", (_case, answer, title, hue) => {
    render(<ToastRegion frame="rail" />);

    act(() => toastAnswer(answer, COPY.shared.state.agreed));

    const toast = screen.getByText(title).closest<HTMLElement>("[data-kit-focus='ring']");
    expect(toast?.querySelector(`.${hue}`)).toBeTruthy();
  });

  // The harm: a refusal or a partial outcome gone before its person read it, the toast being the one place it is said,
  // such as an erasure whose sign-in account stands.
  it("lets a done act's toast leave by itself and keeps a refusal and a partial outcome until each is closed", () => {
    render(<ToastRegion frame="rail" />);
    act(() => {
      toastAnswer({ ok: true, value: undefined }, COPY.shared.state.agreed);
      toastAnswer({ ok: false, reason: COPY.shared.failure.stale }, COPY.shared.state.agreed);
      toastAnswer({ ok: false, reason: COPY.shared.failure.tooManyAttempts, warn: true }, COPY.shared.state.agreed);
      toastAnswer({ ok: true, value: undefined, note: COPY.shared.addressChange.previousStays, warn: true }, COPY.shared.state.agreed);
    });

    act(() => vi.runAllTimers());

    expect(screen.queryByText(COPY.shared.state.agreed)).toBeNull();
    expect(screen.getByText(COPY.shared.failure.stale)).toBeTruthy();
    expect(screen.getByText(COPY.shared.failure.tooManyAttempts)).toBeTruthy();
    expect(screen.getByText(COPY.shared.addressChange.previousStays)).toBeTruthy();

    for (const close of screen.getAllByRole("button", { name: COPY.shared.close })) act(() => close.click());

    expect(screen.queryByText(COPY.shared.failure.stale)).toBeNull();
    expect(screen.queryByText(COPY.shared.failure.tooManyAttempts)).toBeNull();
    expect(screen.queryByText(COPY.shared.addressChange.previousStays)).toBeNull();
  });

  // The harm: a save's note that it moved other fixtures gone after the timeout, nothing else on the page saying it.
  it("keeps a done act's note until it is closed, and lets its done word alone leave by itself", () => {
    const done = COPY.shared.toast.done.set;
    const note = COPY.aufstellung.lockedLine;
    render(<ToastRegion frame="rail" />);
    act(() => {
      toastAnswer({ ok: true, value: undefined, note }, done);
      toastAnswer({ ok: true, value: undefined }, done);
    });

    act(() => vi.runAllTimers());

    expect(screen.getByText(note)).toBeTruthy();
    expect(screen.queryByText(done)).toBeNull();
  });

  // The harm: a decline answered from an admission's dialog standing over the list until it is closed, where the same
  // decline from its own row leaves by itself.
  it("says the done word of the act an answer did, and lets it leave by itself as that act's own does", () => {
    const declined = COPY.shared.toast.done.decline;
    render(<ToastRegion frame="rail" />);
    act(() => toastAnswer({ ok: true, value: undefined, done: declined }, COPY.shared.toast.done.set));
    expect(screen.getByText(declined)).toBeTruthy();

    act(() => vi.runAllTimers());

    expect(screen.queryByText(declined)).toBeNull();
  });
});
