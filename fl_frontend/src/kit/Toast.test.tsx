// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { appToast, toastAnswer, ToastRegion } from "./Toast";

const TITLE = COPY.shared.toast.failure;

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
    ["done", { ok: true, value: undefined }, COPY.shared.toast.agreed, "text-success"],
    ["refused", { ok: false, reason: COPY.shared.failure.stale }, COPY.shared.failure.stale, "text-danger"],
  ] as const)("says %s in its own tone", (_case, answer, title, hue) => {
    render(<ToastRegion frame="rail" />);

    act(() => toastAnswer(answer, COPY.shared.toast.agreed));

    const toast = screen.getByText(title).closest<HTMLElement>("[data-kit-focus='ring']");
    expect(toast?.querySelector(`.${hue}`)).toBeTruthy();
  });

  // The harm: a refusal or a partial outcome gone before its person read it, the toast being the one place it is said,
  // such as a ban whose sign-ins run on.
  it("lets a done act's toast leave by itself and keeps a refusal and a partial outcome until each is closed", () => {
    render(<ToastRegion frame="rail" />);
    act(() => {
      toastAnswer({ ok: true, value: undefined }, COPY.shared.toast.agreed);
      toastAnswer({ ok: false, reason: COPY.shared.failure.stale }, COPY.shared.toast.agreed);
      toastAnswer({ ok: false, reason: COPY.admin.banList.partial.sessions, warn: true }, COPY.shared.toast.agreed);
    });

    act(() => vi.runAllTimers());

    expect(screen.queryByText(COPY.shared.toast.agreed)).toBeNull();
    expect(screen.getByText(COPY.shared.failure.stale)).toBeTruthy();
    expect(screen.getByText(COPY.admin.banList.partial.sessions)).toBeTruthy();

    for (const close of screen.getAllByRole("button", { name: COPY.shared.close })) act(() => close.click());

    expect(screen.queryByText(COPY.shared.failure.stale)).toBeNull();
    expect(screen.queryByText(COPY.admin.banList.partial.sessions)).toBeNull();
  });
});
