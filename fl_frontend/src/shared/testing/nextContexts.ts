import { createElement as h } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import type { ReactNode } from "react";

/** Where a component sent the reader, counted and collected so a case asserts over the navigation rather than over the router. */
export interface Navigations {
  readonly pushed: string[];
  readonly replaced: string[];
  back: number;
  refresh: number;
}

/**
 * The router `useRouter` reads off `AppRouterContext`, every member inert unless `overrides` names it.
 *
 * Typed from Next's own interface: a member Next adds is a type error here, where a literal short of
 * one renders until a component calls it.
 */
export function nextRouter(overrides: Partial<AppRouterInstance> = {}): AppRouterInstance {
  return {
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
    push: () => undefined,
    replace: () => undefined,
    prefetch: () => undefined,
    bfcacheId: "",
    ...overrides,
  };
}

/**
 * The same router with the four navigations a case judges recorded, beside the log they land in.
 * Handed back rather than read off the router, whose members carry nothing to compare.
 */
export function recordingRouter(overrides: Partial<AppRouterInstance> = {}): { router: AppRouterInstance; seen: Navigations } {
  const seen: Navigations = { pushed: [], replaced: [], back: 0, refresh: 0 };

  return {
    router: nextRouter({
      // eslint-disable-next-line no-restricted-properties -- the router double counts the history back it stands in for
      back: () => void (seen.back += 1),
      refresh: () => void (seen.refresh += 1),
      push: (href: string) => void seen.pushed.push(href),
      replace: (href: string) => void seen.replaced.push(href),
      ...overrides,
    }),
    seen,
  };
}

/**
 * A tree under the three contexts `next/navigation` reads and exports no provider for. All three
 * every time: without one, a component reading a parameter throws for the wiring.
 */
export function underNext(
  tree: ReactNode,
  {
    router = nextRouter(),
    search = new URLSearchParams(),
    // `null` is what the context carries with no provider at all, so a caller naming no path keeps
    // whatever the component does without one.
    pathname = null,
  }: { router?: AppRouterInstance; search?: URLSearchParams | string; pathname?: string | null } = {},
): ReactNode {
  return h(AppRouterContext.Provider, {
    value: router,
    children: h(SearchParamsContext.Provider, {
      value: typeof search === "string" ? new URLSearchParams(search) : search,
      children: h(PathnameContext.Provider, { value: pathname, children: tree }),
    }),
  });
}
