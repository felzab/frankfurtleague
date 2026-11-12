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
