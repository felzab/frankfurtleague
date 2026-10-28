// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { goBackOrPush } from "./goBackOrPush";

import type { useRouter } from "next/navigation";

const routerSpy = () => {
  const back = vi.fn();
  const push = vi.fn();
  return { router: { back, push } as unknown as ReturnType<typeof useRouter>, back, push };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the way back", () => {
  it("goes back where the tab has somewhere to go back to", () => {
    vi.spyOn(window.history, "length", "get").mockReturnValue(2);
    const { router, back, push } = routerSpy();

    goBackOrPush(router, "/saisons/2027");

    expect(back).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
  });

  it("goes to the fallback from a tab opened at this page", () => {
    vi.spyOn(window.history, "length", "get").mockReturnValue(1);
    const { router, back, push } = routerSpy();

    goBackOrPush(router, "/saisons/2027");

    expect(push).toHaveBeenCalledWith("/saisons/2027");
    expect(back).not.toHaveBeenCalled();
  });
});
