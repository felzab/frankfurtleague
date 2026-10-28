import { createElement as h } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PathnameContext, PathParamsContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import type { Params } from "next/dist/server/request/params.js";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import type { ReactNode } from "react";

/**
 * The router `useRouter` reads off `AppRouterContext`, every member inert unless `overrides` names it.
 *
 * Typed from Next's own interface: a member Next adds is a type error here, where a literal short of
 * one renders until a component calls it.
 */
function nextRouter(overrides: Partial<AppRouterInstance> = {}): AppRouterInstance {
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
 * A tree under the four contexts `next/navigation` reads and exports no provider for. All four
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
    // `null` for the same reason: `useParams()` answers it where no dynamic segment is matched.
    params = null,
  }: { router?: AppRouterInstance; search?: URLSearchParams | string; pathname?: string | null; params?: Params | null } = {},
): ReactNode {
  return h(AppRouterContext.Provider, {
    value: router,
    children: h(SearchParamsContext.Provider, {
      value: typeof search === "string" ? new URLSearchParams(search) : search,
      children: h(PathnameContext.Provider, {
        value: pathname,
        children: h(PathParamsContext.Provider, { value: params, children: tree }),
      }),
    }),
  });
}
