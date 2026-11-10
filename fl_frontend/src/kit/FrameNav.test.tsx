// @vitest-environment jsdom
import { Suspense } from "react";

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { ROUTES } from "@/core/routes";

import { BarPlaces, MenuScope, RailEntries, SaisonScope } from "./FrameNav";

import type { ReactNode } from "react";
import type { RailGroup, Saisons } from "./FrameNav";

const address = vi.hoisted(() => ({ path: "", saison: undefined as string | undefined, team: undefined as string | undefined }));

vi.mock("next/navigation", () => ({
  usePathname: () => address.path,
  useParams: () => ({ saison: address.saison, team: address.team }),
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

const TEAM_GROUPS: RailGroup[] = [
  {
    entries: [
      { id: "uebersicht", label: ROUTES.teamOverview.title, team: "teamOverview", icon: "overview" },
      { id: "spiele", label: ROUTES.teamSpiele.title, team: "teamSpiele", icon: "spielplan" },
      { id: "kader", label: ROUTES.teamKader.title, team: "teamKader", icon: "spieler" },
      { id: "registrierungen", label: ROUTES.teamRegistrierungen.title, team: "teamRegistrierungen", icon: "registrierungen" },
    ],
  },
];

// A team's route takes the team and then the season, a public club page's the season and then the team: an entry filled
// in the other way round, or with another team the person holds, is a link that still renders and leads somewhere else.
describe("a team frame's rail", () => {
  it("leads every entry to the team and the season its address names, and marks the page the person is on", async () => {
    address.path = ROUTES.teamKader.path("ahorn", "2026");
    address.saison = "2026";
    address.team = "ahorn";
    onTestFinished(() => {
      address.team = undefined;
    });
    const teams = [
      { team: "weide", entries: [{ id: "2027", span: "" }], standard: "2027" },
      {
        team: "ahorn",
        entries: [
          { id: "2027", span: "" },
          { id: "2026", span: "" },
        ],
        standard: "2027",
      },
    ];
    await act(async () =>
      render(
        <Suspense fallback={null}>
          <SaisonScope value={{ teams: Promise.resolve(teams), home: "teamOverview", pages: [] }}>
            <RailEntries groups={TEAM_GROUPS} />
          </SaisonScope>
        </Suspense>,
      ),
    );

    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/area/team/ahorn/2026",
      "/area/team/ahorn/2026/spiele",
      "/area/team/ahorn/2026/kader",
      "/area/team/ahorn/2026/registrierungen",
    ]);
    expect(lit()).toEqual([ROUTES.teamKader.title]);
  });
});
