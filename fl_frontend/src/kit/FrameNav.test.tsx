// @vitest-environment jsdom
import { Suspense } from "react";

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ROUTES } from "@/core/routes";

import { BarPlaces, MenuScope, RailEntries, SaisonScope } from "./FrameNav";

import type { ReactNode } from "react";
import type { RailGroup, Saisons } from "./FrameNav";

const address = vi.hoisted(() => ({ path: "", saison: undefined as string | undefined }));

vi.mock("next/navigation", () => ({
  usePathname: () => address.path,
  useParams: () => ({ saison: address.saison }),
  useRouter: () => ({ push: () => undefined }),
}));

// The sheet's list, drawn in place: how the sheet opens is its own test's.
vi.mock("./Sheet", () => ({ Sheet: ({ children }: { children: ReactNode }) => <>{children}</> }));

const GROUPS: RailGroup[] = [
  { entries: [{ id: "uebersicht", label: ROUTES.adminOverview.title, saison: "adminOverview", icon: "overview" }] },
  {
    entries: [
      { id: "saisons", label: ROUTES.adminSaisons.title, href: ROUTES.adminSaisons.path(), icon: "saisons" },
      { id: "spiele", label: ROUTES.adminSpiele.title, saison: "adminSpiele", icon: "spielplan" },
      { id: "teams", label: ROUTES.adminTeams.title, saison: "adminTeams", icon: "teams" },
    ],
  },
];

/** The rail, the phone's bar and its sheet at this address, the sheet holding the two pages the bar leaves out. */
async function renderMenus(path: string, saisons: Saisons | null) {
  address.path = path;
  address.saison = saisons?.standard;
  await act(async () =>
    render(
      <Suspense fallback={null}>
        <SaisonScope value={{ saisons: Promise.resolve(saisons), home: "adminOverview", withoutSaison: ROUTES.adminSaisons.path(), pages: [] }}>
          <MenuScope value={{ groups: GROUPS, bar: ["uebersicht", "saisons"], extra: [] }}>
            <RailEntries groups={GROUPS} />
            <BarPlaces />
          </MenuScope>
        </SaisonScope>
      </Suspense>,
    ),
  );
}

/** Every link marked as the page the person is on, by its name. */
const lit = () => screen.getAllByRole("link", { current: "page" }).map((link) => link.textContent);

// A screen reader announces each entry it marks as the page the person is on, and seven such marks say nothing of where
// they are, which no look at one menu shows without a league holding no season.
describe("the entry marked as the current page", () => {
  it("is the one whose own address it is, in a league with no season, whose season pages all lead to that address", async () => {
    await renderMenus(ROUTES.adminSaisons.path(), null);

    expect(lit()).toEqual([ROUTES.adminSaisons.title, ROUTES.adminSaisons.title]);
  });

  it("is a season's page by its season's address", async () => {
    await renderMenus(ROUTES.adminTeams.path("2027"), { entries: [{ id: "2027", span: "" }], standard: "2027" });

    expect(lit()).toEqual([ROUTES.adminTeams.title, ROUTES.adminTeams.title]);
  });
});
