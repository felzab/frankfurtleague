// @vitest-environment jsdom
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy/shared";
import { serveHost } from "@/test-support/backend";
import { renderUnderNext, underNext } from "@/test-support/nextContexts";
import { drawnOnServer } from "@/test-support/server";

import { useHoldLeave } from "./LeaveGuard";
import { RailFrame } from "./RailFrame";

import type { NextContexts } from "@/test-support/nextContexts";
import type { ComponentProps, ReactNode } from "react";
import type { Account } from "./FrameNav";

/** Next's navigation at the Spielorte, a page whose address names no season. */
const AT_ADDRESS: NextContexts = { pathname: "/admin/spielorte", params: {} };

vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "system", setTheme: () => undefined }) }));

// Next's link, standing in as an anchor saying what it was asked to prefetch.
vi.mock("next/link", async (original) => ({
  ...(await original<object>()),
  default: ({ children, prefetch, ...props }: ComponentProps<"a"> & { prefetch?: boolean | null }) => (
    <a
      data-prefetch={String(prefetch)}
      {...props}>
      {children}
    </a>
  ),
}));

// The document load the sign-out leaves by, which jsdom does not implement.
const leave = vi.hoisted(() => ({ leaveDocumentFor: vi.fn() }));
vi.mock("@/shared/utils/documentNavigation", () => ({ leaveDocumentFor: leave.leaveDocumentFor }));

/**
 * The sign-in library's sign-out endpoint on the page's own host, answering `status` for the rest of the case, and
 * what reads every request the page sent there by its method and path; a request to any other endpoint fails the case.
 */
function signOutAnswers(status: number): () => ReadonlyArray<{ method: string; path: string }> {
  const taken = serveHost("http://localhost", ({ method, url }) =>
    method === "POST" && url.pathname === "/api/auth/sign-out" ? new Response(null, { status }) : undefined,
  );
  return () => taken.map(({ method, url }) => ({ method, path: url.pathname }));
}

const SIGN_OUT = { method: "POST", path: "/api/auth/sign-out" };

// An administrator: the grant stores no name.
const ACCOUNT: Account = { role: COPY.shared.administration, address: { record: "verwaltung@example.com" } };

/** An editor's page holding one unsaved change, as `useEditor` holds its draft's. */
function Draft({ discard }: { discard: () => void }) {
  useHoldLeave(1, discard);
  return <p>Entwurf</p>;
}

/** The frame of a one-page area around a page, its account read as given. */
async function renderFrame(account: Promise<Account | null>, page: ReactNode = <p>Seite</p>) {
  await act(async () =>
    renderUnderNext(
      <RailFrame
        groups={[{ entries: [{ id: "spielorte", label: COPY.page.adminSpielorte, href: "/admin/spielorte", icon: "search" }] }]}
        bar={["spielorte"]}
        foot={{ kind: "account", account }}>
        {page}
      </RailFrame>,
      AT_ADDRESS,
    ),
  );
}

/** Opens the account menu from the rail's row, which holds the role. */
async function openMenu() {
  const row = screen.getByText(COPY.shared.administration).closest("button");
  if (row === null) throw new Error("the account row is no button");
  await userEvent.click(row);
}

beforeEach(() => {
  // The rail's width, where a menu opens as a popover: jsdom has none of the observers the phone's sheet uses.
  vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(new EventTarget(), { media, matches: true }) as MediaQueryList);
  vi.clearAllMocks();
});

// The toast queue is the module's own, so a toast outlives its case: each is closed while the frame's region stands.
afterEach(() => {
  for (const close of screen.queryAllByRole("button", { name: COPY.shared.close })) act(() => close.click());
});

// A frame's prefetch dropped between the frame and its menus makes every press of the season pages wait on the server,
// and one reaching an area's frame costs a server render per entry in view: neither shows in any page's look.
describe("the menu's prefetch", () => {
  it("asks every entry of the rail and of the phone bar for its page whole where the frame says so, and nothing else", async () => {
    await act(async () =>
      renderUnderNext(
        <RailFrame
          groups={[{ entries: [{ id: "tabelle", label: COPY.page.tabelle, href: "/saisons/2027/tabelle", icon: "tabelle" }] }]}
          bar={["tabelle"]}
          foot={{ kind: "signIn", href: "/signin" }}
          prefetch>
          <p>Seite</p>
        </RailFrame>,
        AT_ADDRESS,
      ),
    );

    const entries = screen.getAllByRole("link", { name: COPY.page.tabelle });
    // The rail's entry and the bar's place.
    expect(entries.map((entry) => entry.getAttribute("data-prefetch"))).toEqual(["true", "true"]);
    // The foot's „Konto“, which prefetches nothing: a prefetched sign-in would be drawn before the proxy sends a
    // signed-in person on to their landing.
    expect(screen.getByRole("link", { name: COPY.template.account }).getAttribute("data-prefetch")).toBe("false");
  });

  it("leaves every entry at Next's default in a frame that does not say so", async () => {
    await renderFrame(Promise.resolve(ACCOUNT));

    expect(screen.getAllByRole("link", { name: COPY.page.adminSpielorte }).map((entry) => entry.getAttribute("data-prefetch"))).toEqual([
      "undefined",
      "undefined",
    ]);
  });
});

describe("the account menu", () => {
  it("signs out with one press and leaves the document for the start page", async () => {
    const sent = signOutAnswers(200);
    await renderFrame(Promise.resolve(ACCOUNT));
    await openMenu();

    await userEvent.click(screen.getByRole("menuitem", { name: COPY.shared.verb.signOut }));

    await vi.waitFor(() => expect(leave.leaveDocumentFor).toHaveBeenCalledWith("/"));
    // No toast at all, in any words: the person leaves, and nothing is said on the page they leave.
    expect([sent(), screen.queryAllByRole("alertdialog")]).toStrictEqual([[SIGN_OUT], []]);
  });

  // A sign-out ahead of the question would leave only the browser's empty one, and a person who stays would keep typed
  // values no save can send once the session is gone.
  it("asks over unsaved changes before the session ends, and signs out only once the person discards them", async () => {
    const sent = signOutAnswers(200);
    const discard = vi.fn();
    await renderFrame(Promise.resolve(ACCOUNT), <Draft discard={discard} />);
    await openMenu();

    await userEvent.click(screen.getByRole("menuitem", { name: COPY.shared.verb.signOut }));
    const question = await screen.findByRole("alertdialog");
    expect([sent(), leave.leaveDocumentFor.mock.calls]).toStrictEqual([[], []]);

    await userEvent.click(within(question).getByRole("button", { name: COPY.shared.verb.discard }));
    await vi.waitFor(() => expect(leave.leaveDocumentFor).toHaveBeenCalledWith("/"));
    expect([discard.mock.calls.length, sent()]).toStrictEqual([1, [SIGN_OUT]]);
  });

  it("keeps the person in place with the one failure line where the sign-out fails", async () => {
    const sent = signOutAnswers(500);
    await renderFrame(Promise.resolve(ACCOUNT));
    await openMenu();

    await userEvent.click(screen.getByRole("menuitem", { name: COPY.shared.verb.signOut }));

    const toast = await screen.findByRole("alertdialog", { name: COPY.shared.failure.unexpected });
    expect(toast.querySelector(".text-danger")).toBeTruthy();
    expect([sent(), leave.leaveDocumentFor.mock.calls]).toStrictEqual([[SIGN_OUT], []]);
  });
});

/** The phone's band of the Spielorte's frame as the server sends it at `pathname`, by the name and address of each link. */
async function bandOnServer(pathname: string, params: Record<string, string>) {
  const page = await drawnOnServer(
    underNext(
      <RailFrame
        groups={[{ entries: [{ id: "spielorte", label: COPY.page.adminSpielorte, href: "/admin/spielorte", icon: "search" }] }]}
        bar={["spielorte"]}
        foot={{ kind: "account", account: Promise.resolve(ACCOUNT) }}>
        <p>Seite</p>
      </RailFrame>,
      { pathname, params },
    ),
  );
  // The band is the column's one header outside the page's `main`: the rail's head is no header.
  const band = [...page.querySelectorAll("header")].find((header) => header.closest("main") === null);
  return [...(band?.querySelectorAll("a") ?? [])].map((link) => ({
    name: link.getAttribute("aria-label") ?? link.textContent,
    href: link.getAttribute("href"),
  }));
}

// The frame's layout stays mounted across a navigation, so the band reads the address on the client; a band chosen
// only after hydration would show a phone the logo over an editor until then, which no unit render of a page sees.
describe("the phone's band as the server draws it", () => {
  it("holds „‹ Zurück“ to the list in the logo's place at an editor's address", async () => {
    expect(await bandOnServer("/admin/spielorte/sp-1", { spielort: "sp-1" })).toStrictEqual([
      { name: COPY.shared.back, href: "/admin/spielorte" },
    ]);
  });

  it("holds the logo at a list's address", async () => {
    expect(await bandOnServer("/admin/spielorte", {})).toStrictEqual([{ name: COPY.brand.name, href: "/" }]);
  });
});
