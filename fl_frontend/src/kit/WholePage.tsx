"use client";

// Imports nothing of the kit's: every kit module drawing a link takes `NavigationLink` from here, and a kit module this
// one imported could close a cycle through one of them, whose module would then be read before it is defined.
import { createContext, startTransition, Suspense, useContext, useOptimistic } from "react";
import NextLink, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";

import { ROUTES } from "@/core/routes";

import type { ComponentProps, ReactNode } from "react";

/** Whether the pages below arrive whole, no part of a page waiting in a boundary of its own (`PageWait`). */
const WholeContext = createContext(false);

/** Where a client navigation goes: its address as the browser resolves it, and that address's path and query apart. */
type Pending = { href: string; path: string; search: string };

/** Next's own two options for a navigation, which every navigating control of the kit hands over as it would to Next. */
type NavigateOptions = { replace?: boolean; scroll?: boolean };

type Navigation = {
  /** The address a client navigation is on its way to, from the press until the render that commits its page. */
  pending: Pending | null;
  navigate: (href: string, options?: NavigateOptions) => void;
};

const NavigationContext = createContext<Navigation | null>(null);

/**
 * The pages under it arrive whole, inside one boundary that is mounted once for the session and draws nothing while it
 * waits. A page opened by address sends its shell, the site's themed ground, at once and reveals the whole page in one
 * step once it is rendered, however slowly its bytes arrive; a page that throws while rendering on the server is drawn
 * again in the browser inside that shell. A client navigation keeps the page it leaves until the new one is complete:
 * the boundary is already revealed, and a transition never hides content it has revealed. The layout placing it
 * exports `instant = false`, which lets a navigation block on a page reading uncached data.
 *
 * It also holds the one fact every navigating control feeds, the address a navigation is on its way to: set inside the
 * navigation's own transition as optimistic state, so React drops it in the very render that commits the new page, as
 * Next's own link status is held.
 */
export function WholePages({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, setPending] = useOptimistic<Pending | null>(null);
  const navigate = (href: string, { replace = false, scroll = true }: NavigateOptions = {}) => {
    const url = new URL(href, window.location.href);
    const next = { href: `${url.pathname}${url.search}${url.hash}`, path: url.pathname, search: url.search };
    // A second press of the address already on its way asks nothing new of the server.
    if (next.href === pending?.href) return;
    startTransition(() => {
      setPending(next);
      if (replace) router.replace(href, { scroll });
      else router.push(href, { scroll });
    });
  };
  return (
    <WholeContext value>
      <NavigationContext value={{ pending, navigate }}>
        <Suspense fallback={null}>{children}</Suspense>
      </NavigationContext>
    </WholeContext>
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

/**
 * A template's boundary around what it reads: `children` in a `Suspense` boundary, `fallback` standing while they are
 * read, or under `WholePages` the children alone, so their read holds the whole page. Both are elements, never a
 * function, which a server template could not hand a client component.
 */
export function PageWait({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  return useContext(WholeContext) ? children : <Suspense fallback={fallback}>{children}</Suspense>;
}

/**
 * The pending hint on a pressed link, Next's recipe (`useLinkStatus`): always rendered and taking no room, a dot that
 * fades in only once the navigation has taken 100 ms and pulses until it commits, so a fast one shows nothing. Placed
 * absolutely with no offset, it stands at its static place, after the words in a line of text and at the start of a flex
 * or grid link, and moves nothing. It must stand inside Next's link, whose status it reads. Outside `WholePages` it
 * draws nothing: a page streaming in its parts commits its placeholders within a few frames of the press, before the
 * hint's delay ends.
 */
export function LinkHint() {
  const { pending } = useLinkStatus();
  if (!useContext(WholeContext)) return null;
  return (
    <span
      aria-hidden
      data-pending={pending || undefined}
      className="group/hint pointer-events-none absolute ms-1 mt-1.5 opacity-0 transition-opacity duration-(--motion-in) data-pending:opacity-100 data-pending:delay-100">
      <span className="block size-1.5 rounded-full bg-current opacity-60 group-data-pending/hint:animate-pulse" />
    </span>
  );
}
