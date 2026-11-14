// @vitest-environment jsdom
import { startTransition } from "react";

import { underNext } from "@/test-support/nextContexts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NavigationBar, NavigationLink, PageContent, WholePages } from "./WholePage";

import type NextLink from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * Next's link as its reference documents `onNavigate`: a same-site press calls it, and its `preventDefault` cancels the
 * link's own navigation, which this double never makes. It records what each link was asked to prefetch, by address.
 */
const prefetched = vi.hoisted(() => new Map<string, unknown>());
vi.mock("next/link", async (original) => ({
  ...(await original<object>()),
  default: ({ href, prefetch, onNavigate, replace: _replace, scroll: _scroll, children, ...props }: ComponentProps<typeof NextLink>) => {
    prefetched.set(String(href), prefetch);
    return (
      <a
        {...props}
        href={String(href)}
        onClick={(event) => {
          event.preventDefault();
          onNavigate?.({ preventDefault: () => undefined });
        }}>
        {children}
      </a>
    );
  },
}));

type Router = NonNullable<NonNullable<Parameters<typeof underNext>[1]>["router"]>;

/**
 * The navigations under way, each until its page arrives. React entangles every pending action app-wide, so one left
 * pending would hold every later test's navigation pending with it: each test's are settled after it, however it ends.
 */
const underWay: Array<() => void> = [];

async function arrive() {
  await act(async () => {
    for (const settle of underWay.splice(0)) settle();
  });
}

/**
 * A router whose every navigation stays pending until `arrive`, as Next's stays pending until the page it goes to is
 * read: its `push` runs an action of its own inside the navigation's transition, as Next's dispatch does.
 */
function heldRouter() {
  const navigation = vi.fn(() => {
    const read = Promise.withResolvers<void>();
    underWay.push(read.resolve);
    startTransition(async () => {
      await read.promise;
    });
  });
  const router: Router = {
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
    push: navigation,
    replace: navigation,
    prefetch: () => undefined,
    bfcacheId: "",
  };
  return { router, navigation };
}

/** A page under `WholePages`, its content and the frame's bar beside it, as a frame places them. */
function page(router: Router, content: ReactNode) {
  return render(
    underNext(
      <WholePages>
        <NavigationBar placement="rail" />
        <PageContent>{content}</PageContent>
      </WholePages>,
      { router },
    ),
  );
}

/** A link of the page's content, as the kit draws one. */
const link = (href: string, words: string) => (
  <NavigationLink
    href={href}
    prefetch={false}>
    {words}
  </NavigationLink>
);

const bar = () => document.querySelector("[aria-hidden][data-shown]");

afterEach(async () => {
  vi.useRealTimers();
  await arrive();
  prefetched.clear();
});

describe("a navigation under `WholePages`", () => {
  // The harm: a second press of a link whose page is slow would ask the server for it again, and nothing shows it.
  it("goes to the address already pending once, however often it is pressed, and anew once it has arrived", async () => {
    const { router, navigation } = heldRouter();
    page(router, link("/admin/spielorte", "Spielorte"));

    fireEvent.click(screen.getByText("Spielorte"));
    fireEvent.click(screen.getByText("Spielorte"));
    expect(navigation).toHaveBeenCalledTimes(1);

    await arrive();
    fireEvent.click(screen.getByText("Spielorte"));
    expect(navigation).toHaveBeenCalledTimes(2);
  });

  // The harm: a bar shown at once would flash on every fast click, which most are; one never shown says nothing.
  it("shows the frame's bar once it has been pending 200 ms, and takes it away when the page arrives", async () => {
    vi.useFakeTimers();
    const { router } = heldRouter();
    page(router, link("/admin/spielorte", "Spielorte"));

    fireEvent.click(screen.getByText("Spielorte"));
    act(() => vi.advanceTimersByTime(199));
    expect(bar()).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(bar()).not.toBeNull();

    vi.useRealTimers();
    await arrive();
    expect(bar()).toBeNull();
  });

  // The harm: text typed into a page being left is lost with it, and a filter, a tab or a match opening its pop-up
  // that froze its own page would take its focus away, which the pop-up then has nothing to give back to.
  it("makes the page's content inert while a navigation leaves it, and not while one changing the query or opening the match pop-up is pending", async () => {
    const { router } = heldRouter();
    page(
      router,
      <>
        {link("?tab=2", "Spieltag 2")}
        {link("/saisons/2025-26/spiele/0123456789abcdef01234567", "Spiel")}
        {link("/admin/spielorte", "Spielorte")}
      </>,
    );
    const content = () => screen.getByText("Spieltag 2").closest("[inert]");

    fireEvent.click(screen.getByText("Spieltag 2"));
    expect(content()).toBeNull();
    await arrive();

    fireEvent.click(screen.getByText("Spiel"));
    expect(content()).toBeNull();
    await arrive();

    fireEvent.click(screen.getByText("Spielorte"));
    expect(content()).not.toBeNull();
    await arrive();
    expect(content()).toBeNull();
  });

  // The harm: a prefetched sign-in is drawn for a signed-in person, whom the proxy, skipping a prefetch, never sends on.
  it("never prefetches the sign-in or an address under it, whatever the link asks", () => {
    render(
      underNext(
        <>
          <NavigationLink
            href="/signin?return=%2Farea"
            prefetch>
            Konto
          </NavigationLink>
          <NavigationLink
            href="/signin/passkey"
            prefetch>
            Passkey
          </NavigationLink>
          <NavigationLink
            href="/signing-off"
            prefetch>
            Elsewhere
          </NavigationLink>
        </>,
      ),
    );

    expect(prefetched.get("/signin?return=%2Farea")).toBe(false);
    expect(prefetched.get("/signin/passkey")).toBe(false);
    expect(prefetched.get("/signing-off")).toBe(true);
  });
});
