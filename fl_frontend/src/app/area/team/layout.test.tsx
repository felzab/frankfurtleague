// @vitest-environment jsdom
import { Suspense } from "react";

import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AREA_COPY } from "@/core/copy/area";
import { COPY } from "@/core/copy/shared";
import { formatPeriod } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { serveBackend } from "@/test-support/backend";
import { renderUnderNext } from "@/test-support/nextContexts";
import { signedInRequest } from "@/test-support/session";
import { seat, SEAT } from "@/test-support/subjectFixtures";

import type { CalendarDay } from "@/core/format";

/**
 * A Testing Library text matcher for the element holding `text` whole, where the words stand in parts of their own, as
 * an address standing as a name does (`fl_frontend/src/kit/AddressWords.tsx`): the default matcher reads an element's
 * own text alone and finds none of them.
 */
function wholeText(text: string) {
  return (_: string, node: Element | null) => node?.textContent === text && ![...node.children].some((part) => part.textContent === text);
}

const AHORN = "6890a1b2c3d4e5f607250011";
const WEIDE = "6890a1b2c3d4e5f607250012";
const LINDE = "6890a1b2c3d4e5f607250013";

// A person holding two clubs, one of them in two seasons: Ahorn in the running season and the coming one, Weide in
// a season Ahorn is not held in.
const PERSON = {
  email: "pia@example.org",
  records: {
    seats: [
      seat({ team_id: WEIDE, team_name: "Weide", team_shorthand: "WEI", saison_id: "2028", saison_status: "future" }),
      seat({ team_id: AHORN, team_name: "Ahorn", team_shorthand: "AHO", saison_id: "2026", saison_status: "active" }),
      seat({
        team_id: AHORN,
        team_name: "Ahorn",
        team_shorthand: "AHO",
        saison_id: "2027",
        saison_status: "future",
        saison_start_date: "2026-09-01",
        saison_end_date: "2027-07-31",
        seat: "trainer",
      }),
    ],
  },
};

// No answer of its own: the frame reads nothing beyond the session's lookup, so any other request fails the case.
serveBackend();
// Signed in by a typed code.
signedInRequest(PERSON);
const { default: TeamLayout } = await import("./layout");

/**
 * The team's frame around a page, at a page of `team` in `saison`. The layout is a server component the server renders
 * once, so it is called once here and its reads begin once: drawn as a component by the browser's React, each retry
 * would begin them anew, and a read answered over the network would never settle before the next retry. The render
 * stands in a boundary of its own, where a suspended read can settle before the retry.
 */
async function renderAt(path: (team: string, saison: string) => string, team: string, saison: string) {
  const frame = TeamLayout({ children: <p>Seite</p> });
  await act(async () => renderUnderNext(<Suspense>{frame}</Suspense>, { pathname: path(team, saison), params: { team, saison } }));
  // The frame holds no boundary of its own, so its page shows once every read it waits on is answered: a season
  // button looked for before then is absent for every team.
  await screen.findByText("Seite");
}

/** Where every link of this name leads, in the rail and in the phone's bar. */
const hrefsOf = (name: string) => new Set(screen.getAllByRole("link", { name }).map((link) => link.getAttribute("href")));

/** The season buttons the frame draws, the rail's and the band's. */
const saisonButtons = () => screen.queryAllByRole("button", { name: new RegExp(COPY.shared.saisonName("")) });

beforeEach(() => {
  // The rail's width, where a menu opens as a popover: jsdom has none of the observers the phone's sheet uses.
  vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(new EventTarget(), { media, matches: true }) as MediaQueryList);
});

// The layout stands above the team and the season and is handed neither, so a frame that took the person's first
// team, or every season they hold anywhere, still draws four links, a season button and an account row that all read
// as some team's.
describe("a team's frame for a person holding two teams", () => {
  it("leads its four pages to the team and the season of the address, offers that team's seasons alone and names it in the account row", async () => {
    await renderAt(ROUTES.teamKader.path, AHORN, "2026");

    expect(hrefsOf(ROUTES.teamOverview.title)).toEqual(new Set([ROUTES.teamOverview.path(AHORN, "2026")]));
    expect(hrefsOf(ROUTES.teamSpiele.title)).toEqual(new Set([ROUTES.teamSpiele.path(AHORN, "2026")]));
    expect(hrefsOf(ROUTES.teamKader.title)).toEqual(new Set([ROUTES.teamKader.path(AHORN, "2026")]));
    expect(hrefsOf(ROUTES.teamRegistrierungen.title)).toEqual(new Set([ROUTES.teamRegistrierungen.path(AHORN, "2026")]));

    // Under the person's address: the Kürzel of the address's team and the seat held in the address's season.
    expect(screen.getByText(wholeText(PERSON.email)).nextElementSibling?.textContent).toBe(
      AREA_COPY.team.accountLine({ record: "AHO" }, ["ansprechperson"]),
    );

    const [button] = saisonButtons();
    if (button === undefined) throw new Error("the frame draws no season button");
    expect(button.textContent).toContain(formatPeriod(SEAT.saison_start_date as CalendarDay, SEAT.saison_end_date as CalendarDay));
    await userEvent.click(button);
    expect(screen.getAllByRole("menuitemradio").map((entry) => entry.getAttribute("href"))).toEqual([
      ROUTES.teamKader.path(AHORN, "2027"),
      ROUTES.teamKader.path(AHORN, "2026"),
    ]);
  });

  // The harm: on a page of the season the team's place does not open on, the account row reads the area's line and
  // „Funktion wechseln“ marks no place, as if the page lay under none of the person's.
  it("marks the team and names that season's seat in the account row on a page of its other season", async () => {
    await renderAt(ROUTES.teamKader.path, AHORN, "2027");

    const row = screen.getByText(wholeText(PERSON.email));
    expect(row.nextElementSibling?.textContent).toBe(AREA_COPY.team.accountLine({ record: "AHO" }, ["trainer"]));

    const opener = row.closest("button");
    if (opener === null) throw new Error("the account row is no button");
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole("menuitem", { name: COPY.shared.switchRole }));
    expect(
      screen
        .getAllByRole("menuitemradio")
        .filter((entry) => entry.getAttribute("aria-checked") === "true")
        .map((entry) => entry.getAttribute("href")),
    ).toEqual([ROUTES.teamOverview.path(AHORN, "2026")]);
  });

  it("offers no season on a team the person does not hold, whose address names none of theirs", async () => {
    await renderAt(ROUTES.teamKader.path, LINDE, "2027");

    expect(hrefsOf(ROUTES.teamKader.title)).toEqual(new Set([ROUTES.teamKader.path(LINDE, "2027")]));
    expect(saisonButtons()).toEqual([]);
  });
});
