import { createElement as h } from "react";
import { AppRouterContext, LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PathnameContext, PathParamsContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";
import { PAGE_SEGMENT_KEY } from "next/dist/shared/lib/segment.js";

import { render, renderHook } from "@testing-library/react";

import type { RenderHookOptions, RenderHookResult, RenderResult } from "@testing-library/react";
import type { Params } from "next/dist/server/request/params.js";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import type { CacheNode, FlightRouterState } from "next/dist/shared/lib/app-router-types.js";
import type { ContextType, ReactNode } from "react";

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
 * What the five contexts hold: Next's router, the address's search, its path, its dynamic segments' values, and the
 * segments below the layout the tree stands in, route groups among them, as `useSelectedLayoutSegments` answers them.
 */
export type NextContexts = {
  router?: AppRouterInstance;
  search?: URLSearchParams | string;
  pathname?: string | null;
  params?: Params | null;
  segments?: readonly string[];
};

type LayoutRouter = NonNullable<ContextType<typeof LayoutRouterContext>>;

/**
 * The layout's context, holding only the members `next/navigation`'s hooks read: the route tree below the layout,
 * which `useSelectedLayoutSegments` walks to the page, and the layout's cache node's `bfcacheId`, which `useRouter`
 * reads. Its other members are Next's own cache records, whose opaque types no public function builds, so a member a
 * hook comes to read fails the case that reaches it, loudly.
 */
function layoutRouter(segments: readonly string[]): LayoutRouter {
  const page: FlightRouterState = [PAGE_SEGMENT_KEY, {}];
  const below = segments.reduceRight<FlightRouterState>((child, segment) => [segment, { children: child }], page);
  const read: Pick<LayoutRouter, "parentTree"> & { parentRenderTree: { data: Pick<CacheNode, "bfcacheId"> } } = {
    parentTree: ["", { children: below }],
    parentRenderTree: { data: { bfcacheId: 0 } },
  };
  return read as LayoutRouter;
}

/**
 * A tree under the five contexts `next/navigation` reads and exports no provider for. All five
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
    // None, as a layout's own page answers.
    segments = [],
  }: NextContexts = {},
): ReactNode {
  return h(AppRouterContext.Provider, {
    value: router,
    children: h(LayoutRouterContext.Provider, {
      value: layoutRouter(segments),
      children: h(SearchParamsContext.Provider, {
        value: typeof search === "string" ? new URLSearchParams(search) : search,
        children: h(PathnameContext.Provider, {
          value: pathname,
          children: h(PathParamsContext.Provider, { value: params, children: tree }),
        }),
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
