import { createElement as h } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PathnameContext, PathParamsContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { render, renderHook } from "@testing-library/react";

import type { RenderHookOptions, RenderHookResult, RenderResult } from "@testing-library/react";
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

/** What the four contexts hold: Next's router, the address's search, its path and its dynamic segments' values. */
export type NextContexts = { router?: AppRouterInstance; search?: URLSearchParams | string; pathname?: string | null; params?: Params | null };

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
  }: NextContexts = {},
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

/**
 * Testing Library's wrapper drawing every tree under Next's contexts, its documented custom render
 * (https://testing-library.com/docs/react-testing-library/setup#custom-render): a `rerender` draws the new tree
 * under them too. Contexts handed as a function are read at each render, for a case whose address moves.
 */
const nextWrapper =
  (contexts: NextContexts | (() => NextContexts)) =>
  ({ children }: { children: ReactNode }) =>
    underNext(children, typeof contexts === "function" ? contexts() : contexts);

/** `ui` rendered into the document under Next's contexts, as a page stands under Next's router. */
export function renderUnderNext(ui: ReactNode, contexts: NextContexts | (() => NextContexts) = {}): RenderResult {
  return render(ui, { wrapper: nextWrapper(contexts) });
}

/** `hook` run in a component under Next's contexts, as `renderUnderNext` draws a tree. */
export function renderHookUnderNext<Result, Props>(
  hook: (props: Props) => Result,
  contexts: NextContexts | (() => NextContexts) = {},
  options: Omit<RenderHookOptions<Props>, "wrapper"> = {},
): RenderHookResult<Result, Props> {
  return renderHook(hook, { ...options, wrapper: nextWrapper(contexts) });
}
