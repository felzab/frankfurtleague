// @vitest-environment jsdom
import { Suspense } from "react";

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import { AccountRow, RailEntries } from "./FrameNav";

const address = vi.hoisted(() => ({ path: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => address.path,
  useParams: () => ({ saison: "2027" }),
  useRouter: () => ({ push: () => undefined }),
}));

/** The rail's entries marked current on the page at `path`. */
function currentOn(path: string) {
  address.path = path;
  render(
    <RailEntries
      groups={[
        {
          entries: [
            { id: "uebersicht", label: COPY.shared.overview, href: ROUTES.adminOverview.path("2027"), icon: "overview" },
            { id: "saisons", label: COPY.page.adminSaisons, href: ROUTES.adminSaisons.path(), icon: "saisons" },
            { id: "spiele", label: COPY.page.spiele, href: ROUTES.adminSpiele.path("2027"), icon: "spielplan" },
          ],
        },
      ]}
    />,
  );
  return screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent);
}

describe("the rail's current entry", () => {
  // The season editor's address lies under the season's Übersicht, so the longest prefix alone marks the Übersicht,
  // and the editor's way back leads there, with every other check green.
  it("is the one a page's route declares, where its address lies under another entry's", () => {
    expect(currentOn(ROUTES.adminSaison.path("2027"))).toStrictEqual([COPY.page.adminSaisons]);
  });

  // A matchday's editor names its record in its address too, so a match on the season alone would never find it.
  it("is the one a record's page declares, whatever record its address names", () => {
    expect(currentOn(ROUTES.adminSpieltag.path("2027", "64b000000000000000000002"))).toStrictEqual([COPY.page.spiele]);
  });
});

describe("the account menu's head", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The row is one line, which cuts a long address, and a page review on a short one sees nothing missing: the menu is
  // the one place an administrator, whose grant stores no name, reads whom they are signed in as.
  it("names an administrator by the whole address, which the row cuts", async () => {
    // The desktop menu, which opens on the page; the test window's media queries answer the phone otherwise.
    const narrow = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(narrow(media), { matches: true }));
    const address = "verwaltung.frankfurt-league@example.com";
    // The row reads its account with `use`, so the render settles once the read has.
    await act(async () => {
      render(
        <Suspense>
          <AccountRow account={Promise.resolve({ role: COPY.admin.role, address: { record: address } })} />
        </Suspense>,
      );
    });
    await userEvent.click(await screen.findByRole("button", { name: new RegExp(address) }));

    const popover = screen.getByRole("menu").parentElement;
    expect(popover).not.toBe(null);
    const head = within(popover!).getByText(address);
    expect(head.className.split(" ")).not.toContain("truncate");
    expect(head.className.split(" ")).toContain("wrap-anywhere");
  });
});
