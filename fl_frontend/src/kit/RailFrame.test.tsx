// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { RailFrame } from "./RailFrame";

import type { ComponentProps } from "react";
import type { Account } from "./FrameNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/spielorte",
  useParams: () => ({}),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

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

const leave = vi.hoisted(() => ({ signOut: vi.fn(), leaveDocumentFor: vi.fn(), appToast: vi.fn() }));
vi.mock("@/shared/utils/signOut", () => ({ signOut: leave.signOut }));
vi.mock("@/shared/utils/documentNavigation", () => ({ leaveDocumentFor: leave.leaveDocumentFor }));
vi.mock("./Toast", async (original) => ({ ...(await original<Record<string, unknown>>()), appToast: leave.appToast }));

// An administrator: the grant stores no name.
const ACCOUNT: Account = { role: COPY.admin.role, address: { record: "verwaltung@example.com" } };

/** The frame of a one-page area around a page, its account read as given. */
async function renderFrame(account: Promise<Account | null>) {
  await act(async () =>
    render(
      <RailFrame
        groups={[{ entries: [{ id: "spielorte", label: COPY.page.adminSpielorte, href: "/admin/spielorte", icon: "search" }] }]}
        bar={["spielorte"]}
        foot={{ kind: "account", account }}>
        <p>Seite</p>
      </RailFrame>,
    ),
  );
}

/** Opens the account menu from the rail's row, which holds the role. */
async function openMenu() {
  const row = screen.getByText(COPY.admin.role).closest("button");
  if (row === null) throw new Error("the account row is no button");
  await userEvent.click(row);
}

beforeEach(() => {
  // The rail's width, where a menu opens as a popover: jsdom has none of the observers the phone's sheet uses.
  vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(new EventTarget(), { media, matches: true }) as MediaQueryList);
  vi.clearAllMocks();
});

// A frame's prefetch dropped between the frame and its menus costs a placeholder on every press of the season pages, and
// one reaching an area's frame a server render per entry in view: neither shows in any page's look.
describe("the menu's prefetch", () => {
  it("asks every entry of the rail and of the phone bar for its page whole where the frame says so, and nothing else", async () => {
    await act(async () =>
      render(
        <RailFrame
          groups={[{ entries: [{ id: "tabelle", label: COPY.page.tabelle, href: "/saisons/2027/tabelle", icon: "tabelle" }] }]}
          bar={["tabelle"]}
          foot={{ kind: "signIn", href: "/signin" }}
          prefetch>
          <p>Seite</p>
        </RailFrame>,
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
    leave.signOut.mockResolvedValue(true);
    await renderFrame(Promise.resolve(ACCOUNT));
    await openMenu();

    await userEvent.click(screen.getByRole("menuitem", { name: COPY.shared.verb.signOut }));

    await vi.waitFor(() => expect(leave.leaveDocumentFor).toHaveBeenCalledWith("/"));
    expect(leave.appToast).not.toHaveBeenCalled();
  });

  it("keeps the person in place with the one failure line where the sign-out fails", async () => {
    leave.signOut.mockResolvedValue(false);
    await renderFrame(Promise.resolve(ACCOUNT));
    await openMenu();

    await userEvent.click(screen.getByRole("menuitem", { name: COPY.shared.verb.signOut }));

    await vi.waitFor(() => expect(leave.appToast).toHaveBeenCalledWith("danger", COPY.shared.toast.failure));
    expect(leave.leaveDocumentFor).not.toHaveBeenCalled();
  });
});
