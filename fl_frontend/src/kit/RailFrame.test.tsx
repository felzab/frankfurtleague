// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { COPY } from "@/core/copy";

import { RailFrame } from "./RailFrame";

import type { Account } from "./FrameNav";

const address = vi.hoisted(() => ({ path: "/admin/spielorte" }));
vi.mock("next/navigation", () => ({
  usePathname: () => address.path,
  useParams: () => ({}),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "system", setTheme: () => undefined }) }));

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

describe("the account menu", () => {
  it("signs out with one press and leaves the document for the start page", async () => {
    leave.signOut.mockResolvedValue({ success: true });
    await renderFrame(Promise.resolve(ACCOUNT));
    await openMenu();

    await userEvent.click(screen.getByRole("menuitem", { name: COPY.shared.verb.signOut }));

    await vi.waitFor(() => expect(leave.leaveDocumentFor).toHaveBeenCalledWith("/"));
    expect(leave.appToast).not.toHaveBeenCalled();
  });

  it("keeps the person in place with the one failure line where the sign-out fails", async () => {
    leave.signOut.mockResolvedValue({ success: false, error: "x" });
    await renderFrame(Promise.resolve(ACCOUNT));
    await openMenu();

    await userEvent.click(screen.getByRole("menuitem", { name: COPY.shared.verb.signOut }));

    await vi.waitFor(() => expect(leave.appToast).toHaveBeenCalledWith("danger", COPY.shared.toast.failure));
    expect(leave.leaveDocumentFor).not.toHaveBeenCalled();
  });

  // The layout reading the person stands above a team's address, so it can name the kind of place and never which
  // team or season: a mark set there lands on the first of a person's team places wherever they are.
  it.each([
    { path: "/area/team/ahorn/2026/kader", marked: ["/area/team/ahorn/2026"] },
    { path: "/admin/spielorte", marked: ["/admin"] },
    { path: "/account/security", marked: [] },
  ])("marks under „Funktion wechseln“ the place the page at $path lies under", async ({ path, marked }) => {
    address.path = path;
    onTestFinished(() => {
      address.path = "/admin/spielorte";
    });
    const roles = [
      { href: "/area/team/ahorn/2027", label: { record: "Ahorn" }, detail: COPY.shared.saisonName("2027") },
      { href: "/area/team/ahorn/2026", label: { record: "Ahorn" }, detail: COPY.shared.saisonName("2026") },
      { href: "/area/team/weide/2027", label: { record: "Weide" } },
      { href: "/admin", label: COPY.admin.role },
    ];
    await renderFrame(Promise.resolve({ ...ACCOUNT, roles }));
    await openMenu();

    await userEvent.hover(screen.getByRole("menuitem", { name: COPY.shared.switchRole }));
    const places = await screen.findByRole("menu", { name: COPY.shared.switchRole });

    expect(
      within(places)
        .queryAllByRole("menuitemradio", { checked: true })
        .map((place) => place.getAttribute("href")),
    ).toEqual(marked);
  });
});
