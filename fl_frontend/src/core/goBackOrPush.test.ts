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
  vi.unstubAllGlobals();
});

describe("the way back", () => {
  it("goes back where the site has an entry to go back to", () => {
    vi.stubGlobal("navigation", { canGoBack: true });
    const { router, back, push } = routerSpy();

    goBackOrPush(router, "/saisons/2027");

    expect(back).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
  });

  // The tab's history holds the search result or the mail the visitor came from, which Back would return to.
  it("goes to the fallback where the tab's earlier entries are another site's", () => {
    vi.stubGlobal("navigation", { canGoBack: false });
    vi.spyOn(window.history, "length", "get").mockReturnValue(2);
    const { router, back, push } = routerSpy();

    goBackOrPush(router, "/saisons/2027");

    expect(push).toHaveBeenCalledWith("/saisons/2027");
    expect(back).not.toHaveBeenCalled();
  });

  // jsdom has no `navigation`, as the older Firefox and Safari the site serves have none.
  it.each([
    [2, "back"],
    [1, "push"],
  ] as const)("reads a history length of %i as %s where the browser has no navigation", (length, called) => {
    vi.spyOn(window.history, "length", "get").mockReturnValue(length);
    const spy = routerSpy();

    goBackOrPush(spy.router, "/saisons/2027");

    expect(spy[called]).toHaveBeenCalledOnce();
  });
});
