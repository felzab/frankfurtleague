// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { RailFrame } from "./RailFrame";

import type { Account } from "./FrameNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/spielorte",
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
});
