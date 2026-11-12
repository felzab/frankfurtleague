// @vitest-environment jsdom
import { Suspense } from "react";

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { ROUTES } from "@/core/routes";

import { BarPlaces, EditorBack, MenuScope, RailEntries, SaisonScope } from "./FrameNav";

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
  { entries: [{ id: "overview", label: ROUTES.adminOverview.title, saison: "adminOverview", icon: "overview" }] },
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
          <MenuScope value={{ groups: GROUPS, bar: ["overview", "saisons"], extra: [] }}>
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

// The entry the person is on is lit and marked: in a league or a frame holding no season every season entry leads to one
// address, so a rule lighting each entry it leads to lights several, or the wrong one, which no look at a menu shows
// outside that state.
describe("the entry marked as the current page", () => {
  it("is the one whose own address it is, in a league with no season, whose season pages all lead to that address", async () => {
    await renderMenus(ROUTES.adminSaisons.path(), null);

    expect(lit()).toEqual([ROUTES.adminSaisons.title, ROUTES.adminSaisons.title]);
  });

  it("is the one season page of a frame holding no season, at the address it leads to meanwhile", async () => {
    const page = ROUTES.schiedsrichterOverview;
    address.path = ROUTES.areaSchiedsrichter.path();
    address.saison = undefined;
    await act(async () =>
      render(
        <Suspense fallback={null}>
          <SaisonScope value={{ saisons: Promise.resolve(null), home: "schiedsrichterOverview", withoutSaison: address.path, pages: [] }}>
            <RailEntries groups={[{ entries: [{ id: "overview", label: page.title, saison: "schiedsrichterOverview", icon: "overview" }] }]} />
          </SaisonScope>
        </Suspense>,
      ),
    );

    expect(lit()).toEqual([page.title]);
  });
});

/** A read of the seasons that has not landed, as the frame's is on a page's first load while the backend answers. */
const PENDING = new Promise<never>(() => undefined);

/** Where each link of the rail, the bar and its sheet leads. */
const hrefs = () => screen.getAllByRole("link").map((link) => link.getAttribute("href"));

// The address alone spells every season page's address, so a menu that waits on the seasons' read draws placeholders a
// load need not show, and nothing but a recording of a slow read shows it.
describe("the entries on a page whose address names the season", () => {
  it("lead to that season's pages, and an editor's way back to its list, while the seasons are still read", async () => {
    address.path = ROUTES.adminSpiel.path("2026", "6890a1b2c3d4e5f607190001");
    address.saison = "2026";
    await act(async () =>
      render(
        <Suspense fallback={null}>
          <SaisonScope value={{ saisons: PENDING, home: "adminOverview", withoutSaison: ROUTES.adminSaisons.path(), pages: [] }}>
            <MenuScope value={{ groups: GROUPS, bar: ["overview", "saisons"], extra: [] }}>
              <RailEntries groups={GROUPS} />
              <BarPlaces />
              <EditorBack />
            </MenuScope>
          </SaisonScope>
        </Suspense>,
      ),
    );

    const rail = [
      ROUTES.adminOverview.path("2026"),
      ROUTES.adminSaisons.path(),
      ROUTES.adminSpiele.path("2026"),
      ROUTES.adminTeams.path("2026"),
    ];
    // The rail's four, the bar's two places, the sheet's two the bar leaves out, and the editor's way back.
    expect(hrefs()).toEqual([...rail, ...rail.slice(0, 2), ...rail.slice(2), ROUTES.adminSpiele.path("2026")]);
  });

  it("lead to the team's pages in that season in a team's frame while the seats are still read", async () => {
    address.path = ROUTES.teamKader.path("ahorn", "2026");
    address.saison = "2026";
    address.team = "ahorn";
    onTestFinished(() => {
      address.team = undefined;
    });
    await act(async () =>
      render(
        <Suspense fallback={null}>
          <SaisonScope value={{ teams: PENDING, home: "teamOverview", pages: [] }}>
            <RailEntries groups={TEAM_GROUPS} />
          </SaisonScope>
        </Suspense>,
      ),
    );

    expect(hrefs()).toEqual([
      ROUTES.teamOverview.path("ahorn", "2026"),
      ROUTES.teamSpiele.path("ahorn", "2026"),
      ROUTES.teamKader.path("ahorn", "2026"),
      ROUTES.teamRegistrierungen.path("ahorn", "2026"),
    ]);
  });
});

// A page whose address names no season, such as the Spielorte, keeps the season the person last chose: one that fell back
// to the standard would send their next press into another season's pages, which looks right on every page alone.
describe("the season a page whose address names none works in", () => {
  it("is the one the last address named, while the frame stays mounted", async () => {
    const seasons = Promise.resolve<Saisons>({
      entries: [
        { id: "2026", span: "" },
        { id: "2025", span: "" },
      ],
      standard: "2026",
    });
    const menus = () => (
      <Suspense fallback={null}>
        <SaisonScope value={{ saisons: seasons, home: "adminOverview", withoutSaison: ROUTES.adminSaisons.path(), pages: [] }}>
          <RailEntries groups={GROUPS} />
        </SaisonScope>
      </Suspense>
    );
    address.path = ROUTES.adminSpiele.path("2025");
    address.saison = "2025";
    const { rerender } = await act(async () => render(menus()));

    address.path = ROUTES.adminSpielorte.path();
    address.saison = undefined;
    await act(async () => rerender(menus()));

    expect(hrefs()).toEqual([
      ROUTES.adminOverview.path("2025"),
      ROUTES.adminSaisons.path(),
      ROUTES.adminSpiele.path("2025"),
      ROUTES.adminTeams.path("2025"),
    ]);
  });

  // A role's root draws the standard season's Übersicht, so a frame keeping the season chosen before there names 2025
  // around a page showing 2026, and marks no entry for the page the person is on.
  it("is the standard at the role's root, whose Übersicht is the entry marked, whatever was chosen before", async () => {
    const seasons = Promise.resolve<Saisons>({
      entries: [
        { id: "2026", span: "" },
        { id: "2025", span: "" },
      ],
      standard: "2026",
    });
    const menus = () => (
      <Suspense fallback={null}>
        <SaisonScope value={{ saisons: seasons, home: "adminOverview", withoutSaison: ROUTES.adminSaisons.path(), pages: [] }}>
          <RailEntries groups={GROUPS} />
        </SaisonScope>
      </Suspense>
    );
    address.path = ROUTES.adminSpiele.path("2025");
    address.saison = "2025";
    const { rerender } = await act(async () => render(menus()));

    address.path = ROUTES.admin.path();
    address.saison = undefined;
    await act(async () => rerender(menus()));

    expect(hrefs()).toEqual([
      ROUTES.adminOverview.path("2026"),
      ROUTES.adminSaisons.path(),
      ROUTES.adminSpiele.path("2026"),
      ROUTES.adminTeams.path("2026"),
    ]);
    expect(lit()).toEqual([ROUTES.adminOverview.title]);
  });
});

const TEAM_GROUPS: RailGroup[] = [
  {
    entries: [
      { id: "overview", label: ROUTES.teamOverview.title, team: "teamOverview", icon: "overview" },
      { id: "spiele", label: ROUTES.teamSpiele.title, team: "teamSpiele", icon: "spielplan" },
      { id: "kader", label: ROUTES.teamKader.title, team: "teamKader", icon: "spieler" },
      { id: "registrierungen", label: ROUTES.teamRegistrierungen.title, team: "teamRegistrierungen", icon: "registrierungen" },
    ],
  },
];

/** A person holding the club Ahorn in two seasons and the club Weide in one. */
const TEAMS = [
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

/** That person's team rail at the Kader page of a team's season, by where each entry leads. */
async function teamRailAt(team: string, saison: string) {
  address.path = ROUTES.teamKader.path(team, saison);
  address.saison = saison;
  address.team = team;
  onTestFinished(() => {
    address.team = undefined;
  });
  await act(async () =>
    render(
      <Suspense fallback={null}>
        <SaisonScope value={{ teams: Promise.resolve(TEAMS), home: "teamOverview", pages: [] }}>
          <RailEntries groups={TEAM_GROUPS} />
        </SaisonScope>
      </Suspense>,
    ),
  );
  return screen.getAllByRole("link").map((link) => link.getAttribute("href"));
}

// A team's route takes the team and then the season, a public club page's the season and then the team: an entry filled
// in the other way round, or with another team the person holds, is a link that still renders and leads somewhere else.
describe("a team frame's rail", () => {
  it("leads every entry to the team and the season its address names, and marks the page the person is on", async () => {
    expect(await teamRailAt("ahorn", "2026")).toEqual([
      "/area/team/ahorn/2026",
      "/area/team/ahorn/2026/spiele",
      "/area/team/ahorn/2026/kader",
      "/area/team/ahorn/2026/registrierungen",
    ]);
    expect(lit()).toEqual([ROUTES.teamKader.title]);
  });

  // Each of these pages answers with the refusal, so a menu led to a team the person does hold would show the
  // refusal's card under another team's pages.
  it("keeps the menu at the team and the season the address spells where the person does not hold that team", async () => {
    expect(await teamRailAt("linde", "2025")).toEqual([
      "/area/team/linde/2025",
      "/area/team/linde/2025/spiele",
      "/area/team/linde/2025/kader",
      "/area/team/linde/2025/registrierungen",
    ]);
    expect(lit()).toEqual([ROUTES.teamKader.title]);
  });
});
