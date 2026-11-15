// @vitest-environment jsdom
import { underNext } from "@/test-support/nextContexts";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import { RailFrame } from "./RailFrame";

import type { ComponentProps } from "react";
import type { RailGroup } from "./FrameNav";

// Next's link, standing in as an anchor that says whether its navigation replaces the history entry.
vi.mock("next/link", async (original) => ({
  ...(await original<object>()),
  default: ({ replace, children, ...props }: ComponentProps<"a"> & { replace?: boolean }) => (
    <a
      data-replace={replace}
      {...props}>
      {children}
    </a>
  ),
}));

const GROUPS: RailGroup[] = [
  {
    entries: [
      { id: "overview", label: ROUTES.teamOverview.title, team: "teamOverview", icon: "overview" },
      { id: "spiele", label: ROUTES.teamSpiele.title, team: "teamSpiele", icon: "spielplan" },
      { id: "kader", label: ROUTES.teamKader.title, team: "teamKader", icon: "spieler" },
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

/** The season button's entry for the season, from the team frame's rail at this address. */
async function entryFor(saison: string, pathname: string, params: Record<string, string>) {
  await act(async () =>
    render(
      underNext(
        <RailFrame
          groups={GROUPS}
          bar={["overview", "spiele", "kader"]}
          saison={{ teams: Promise.resolve(TEAMS), home: "teamOverview" }}
          foot={{ kind: "account", account: Promise.resolve(null) }}>
          <p>Seite</p>
        </RailFrame>,
        { pathname, params },
      ),
    ),
  );
  // The rail's button, the first of the two the frame draws; the band's opens the same list.
  const [button] = screen.getAllByRole("button", { name: new RegExp(COPY.shared.saisonName(params.saison ?? "")) });
  if (button === undefined) throw new Error("the frame draws no season button");
  await userEvent.click(button);
  return screen.getByRole("menuitemradio", { name: COPY.shared.saisonName(saison) });
}

/** Where that entry leads. */
async function switchTo(saison: string, pathname: string, params: Record<string, string>) {
  return (await entryFor(saison, pathname, params)).getAttribute("href");
}

beforeEach(() => {
  // The rail's width, where a menu opens as a popover: jsdom has none of the observers the phone's sheet uses.
  vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(new EventTarget(), { media, matches: true }) as MediaQueryList);
});

// A switch that loses the team or the page still lands on a page that renders, so nothing but the address shows it.
describe("the season button in a team's frame", () => {
  it("leads to the same page of the same team in the other season", async () => {
    const href = await switchTo("2026", "/area/team/ahorn/2027/kader", { team: "ahorn", saison: "2027" });

    expect(href).toBe("/area/team/ahorn/2026/kader");
  });

  it("leads from a record's page to the list it lies under, the record having no counterpart in the other season", async () => {
    const href = await switchTo("2026", "/area/team/ahorn/2027/spiele/s1", { team: "ahorn", saison: "2027", spiel: "s1" });

    expect(href).toBe("/area/team/ahorn/2026/spiele");
  });

  // A switch that added a history entry would make Back walk through every season looked at before leaving the pages.
  it("takes the current history entry's place, so Back skips the switch", async () => {
    const entry = await entryFor("2026", "/area/team/ahorn/2027/kader", { team: "ahorn", saison: "2027" });

    expect(entry.getAttribute("data-replace")).toBe("true");
  });
});
