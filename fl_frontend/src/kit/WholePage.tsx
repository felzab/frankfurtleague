"use client";

// Imports nothing of the kit's but `tv`, which imports no kit module: every kit module drawing a link takes
// `NavigationLink` from here, and a kit module this one imported could close a cycle through one of them, whose module
// would then be read before it is defined.
import { createContext, startTransition, useContext, useEffect, useOptimistic, useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";

import { ROUTES } from "@/core/routes";

import { tv } from "./tv";

import type { ComponentProps, ReactNode } from "react";

/**
 * A client navigation under way: where it goes, its address as the browser resolves it with that address's path and
 * query apart, and the address of the page it was pressed on, which a link's relative address is resolved against.
 */
type Pending = { href: string; path: string; search: string; from: URL };

/** Next's own two options for a navigation, which every navigating control of the kit hands over as it would to Next. */
type NavigateOptions = { replace?: boolean; scroll?: boolean };

type Navigation = {
  /** The address a client navigation is on its way to, from the press until the render that commits its page. */
  pending: Pending | null;
  /** Whether the pending navigation has lasted `SHOWN_AFTER`, from when the sign shows until the commit. */
  shown: boolean;
  navigate: (href: string, options?: NavigateOptions) => void;
};

/**
 * How long a navigation is pending before its sign shows: the fast ones, most of them, end sooner and show nothing, as
 * Primer shows no loading state for a short wait, and a wait past it is told.
 */
const SHOWN_AFTER = 200;

const NavigationContext = createContext<Navigation | null>(null);

/**
 * The pages under it, with no boundary above them. A page opened by address is one document, which the server sends
 * once it has rendered the whole page and the browser paints as it parses it. A page that finds nothing, is refused or
 * throws while the server renders it is answered with Next's bare error document, in which the browser draws the
 * segment's not-found or error page once the page's code runs. A client navigation keeps the page it leaves until the
 * new one is complete: Next's router makes it a transition, and a transition never hides content already shown. The
 * layout placing it exports `instant = false`, which tells Next's checks that a navigation into any route may block and
 * that a route's prerendered shell may be empty.
 *
 * It also holds the one fact every navigating control feeds, the address a navigation is on its way to: set inside the
 * navigation's own transition as optimistic state, so React drops it in the very render that commits the new page, as
 * Next's own link status is held.
 */
export function WholePages({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, setPending] = useOptimistic<Pending | null>(null);
  const shown = useShownAfterDelay(pending !== null);
  const navigate = (href: string, { replace = false, scroll = true }: NavigateOptions = {}) => {
    const from = new URL(window.location.href);
    const url = new URL(href, from);
    const next = { href: `${url.pathname}${url.search}${url.hash}`, path: url.pathname, search: url.search, from };
    // A second press of the address already on its way asks nothing new of the server.
    if (next.href === pending?.href) return;
    startTransition(() => {
      setPending(next);
      if (replace) router.replace(href, { scroll });
      else router.push(href, { scroll });
    });
  };
  return <NavigationContext value={{ pending, shown, navigate }}>{children}</NavigationContext>;
}

/**
 * Whether `on` has held for `SHOWN_AFTER`: one timer from the moment it turns on, which a second navigation superseding
 * the first leaves running, so the sign never gaps; off the moment `on` is.
 */
function useShownAfterDelay(on: boolean) {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (!on) return;
    const timer = window.setTimeout(() => setWaited(true), SHOWN_AFTER);
    return () => {
      window.clearTimeout(timer);
      setWaited(false);
    };
  }, [on]);
  return on && waited;
}

/**
 * Which of a list's addresses the pending navigation goes to, so the list marks it current at the press: each resolved
 * against the page it was pressed on, as the browser resolves a link's, a tab's `?tab=2` among them; one naming a query
 * only where the navigation carries that query, one naming none by its path alone.
 */
export function usePressed<Href extends string>(hrefs: ReadonlyArray<Href>): Href | undefined {
  const pending = useContext(NavigationContext)?.pending ?? null;
  if (pending === null) return undefined;
  return hrefs.find((href) => {
    const { pathname, search } = new URL(href, pending.from);
    return pathname === pending.path && (search === "" || search === pending.search);
  });
}

/** Whether the pending navigation stays on the page's own path, as a filter or a tab does. */
const staysOnPath = (pending: Pending) => pending.path === pending.from.pathname;

/** The query of a navigation pending to the page's own path, as a filter changes it; `null` while none is. */
export function usePendingQuery(): URLSearchParams | null {
  const pending = useContext(NavigationContext)?.pending ?? null;
  return pending !== null && staysOnPath(pending) ? new URLSearchParams(pending.search) : null;
}

const bar = tv({
  // Never pressed and never read: the page under it stays the one to press, and the sign is a visual one alone.
  base: "pointer-events-none fixed inset-x-0 z-20 h-0.75 overflow-hidden opacity-0 data-shown:opacity-100 data-shown:transition-opacity data-shown:duration-(--motion-in)",
  variants: {
    // At the top edge of the page area, under the band on a phone and under the title strip beside the rail on desktop,
    // its start following the rail's width as it collapses; under the classic header.
    placement: {
      rail: "top-(--rail-band) lg:start-(--rail-width) lg:top-(--rail-strip)",
      classic: "top-(--classic-header)",
    },
  },
});

/**
 * The one sign that a navigation is under way: a thin bar at the top of the page area, which each frame places once,
 * outside every link and every scroll box. It shows once a navigation has been pending `SHOWN_AFTER`, fading in where
 * motion is welcome and at once where it is not, and goes in the render that commits the new page. Where motion is
 * welcome a segment crosses it (`kit-navigation`, in the tokens); where it is not the whole bar pulses, since a
 * loading sign never stops. Its segment is the brand green, which keeps 4.5:1 on every ground of the page in both
 * themes.
 */
export function NavigationBar({ placement }: { placement: "rail" | "classic" }) {
  const shown = useContext(NavigationContext)?.shown ?? false;
  return (
    <span
      aria-hidden
      data-shown={shown || undefined}
      className={bar({ placement })}>
      <span className="block h-full w-1/3 animate-[kit-navigation_1.2s_ease-in-out_infinite] rounded-full bg-brand motion-reduce:w-full motion-reduce:animate-pulse" />
    </span>
  );
}

/**
 * The page's own content, which a frame places it in: `inert` while a navigation to another path is pending, so nothing
 * typed, pressed or selected in a page being left reaches it, and it leaves the accessibility tree; the frame around it
 * stays pressable, so a second press still wins, and the bar says what inertness alone would not. A navigation staying
 * on the path, a filter's or a tab's, leaves the page live. It draws no box (`display: contents`), so it moves nothing
 * and takes no picture of its own in a page's cross-fade.
 */
export function PageContent({ children }: { children: ReactNode }) {
  const pending = useContext(NavigationContext)?.pending ?? null;
  return (
    <div
      className="contents"
      inert={pending !== null && !staysOnPath(pending)}>
      {children}
    </div>
  );
}

/**
 * A client navigation fed through the fact `WholePages` holds, for a control that navigates on its own press rather
 * than through a link, as Next's `router.push` and `router.replace` do. Outside `WholePages` it is Next's router alone.
 */
export function useNavigate(): Navigation["navigate"] {
  const navigation = useContext(NavigationContext);
  const router = useRouter();
  if (navigation !== null) return navigation.navigate;
  return (href, { replace = false, scroll = true } = {}) => {
    if (replace) router.replace(href, { scroll });
    else router.push(href, { scroll });
  };
}

/**
 * Whether an address is the sign-in's or lies under it, which no link prefetches: the proxy sends a signed-in person on
 * from a page load of it, but its matcher never runs on a prefetch, so a prefetched sign-in would be drawn for them.
 */
function isSignIn(href: string) {
  const path = href.split(/[?#]/, 1)[0];
  return path === ROUTES.signIn.path() || path?.startsWith(`${ROUTES.signIn.path()}/`) === true;
}

/**
 * Next's link, the kit's one, whose client navigation goes through the fact `WholePages` holds: its `onNavigate`, which
 * Next calls for a same-site press only, cancels the link's own dispatch and makes the same one there. A press with a
 * modifier key, another site's address and a download stay the browser's. Outside `WholePages` it navigates as Next's
 * link does. It prefetches as it is told, but never the sign-in (`isSignIn`).
 */
export function NavigationLink({
  href,
  replace,
  scroll,
  prefetch,
  ...props
}: Omit<ComponentProps<typeof NextLink>, "href" | "onNavigate"> & { href: string }) {
  const navigation = useContext(NavigationContext);
  return (
    <NextLink
      {...props}
      href={href}
      replace={replace}
      scroll={scroll}
      prefetch={isSignIn(href) ? false : prefetch}
      onNavigate={
        navigation === null
          ? undefined
          : (event) => {
              event.preventDefault();
              navigation.navigate(href, { replace, scroll });
            }
      }
    />
  );
}
