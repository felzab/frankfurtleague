// @vitest-environment jsdom
import { underNext } from "@/test-support/nextContexts";
import { person, seat, SEAT } from "@/test-support/subjectFixtures";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { formatPeriod } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";

import TeamLayout from "./layout";
import TeamNotFound from "./not-found";

import type { CalendarDay } from "@/core/format";
import type { ReactNode } from "react";

const AHORN = "6890a1b2c3d4e5f607250011";
const WEIDE = "6890a1b2c3d4e5f607250012";
const LINDE = "6890a1b2c3d4e5f607250013";

// A person holding two clubs, one of them in two seasons: Ahorn in the running season and the coming one, Weide in
// a season Ahorn is not held in.
const SUBJECT = person({
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
      rolle: "trainer",
    }),
  ],
});

vi.mock("@/core/subject", () => ({ getSubjectSession: () => Promise.resolve(SUBJECT) }));
// The account's other guard, which Konto's pages ask and no frame does: its module opens the sign-in store.
vi.mock("@/core/auth/guards", () => ({ getAccountSession: () => Promise.resolve(null) }));

/** The team's frame around `page`, at a page of `team` in `saison`. */
async function renderAt(path: (team: string, saison: string) => string, team: string, saison: string, page: ReactNode = <p>Seite</p>) {
  await act(async () => render(underNext(<TeamLayout>{page}</TeamLayout>, { pathname: path(team, saison), params: { team, saison } })));
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
    expect(screen.getByText(SUBJECT.email).nextElementSibling?.textContent).toBe(
      COPY.area.team.accountLine({ record: "AHO" }, ["ansprechperson"]),
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

  it("offers no season on a team the person does not hold, whose address names none of theirs", async () => {
    await renderAt(ROUTES.teamKader.path, LINDE, "2027");

    expect(hrefsOf(ROUTES.teamKader.title)).toEqual(new Set([ROUTES.teamKader.path(LINDE, "2027")]));
    expect(saisonButtons()).toEqual([]);
  });
});

// A page's read ends on one boundary for a missing record and for a team the person holds no seat on, and the
// boundary is told neither which nor where: the wrong card of the two still reads as a finished page.
describe("where a team page's read ends without a page", () => {
  it.each([
    { held: "a team and season the person holds", team: AHORN, saison: "2026", title: SERVER_COPY.notFound },
    { held: "a team the person does not hold", team: LINDE, saison: "2027", title: SERVER_COPY.area.forbidden },
    { held: "a season the person does not hold the team in", team: WEIDE, saison: "2026", title: SERVER_COPY.area.forbidden },
  ])("names $title at $held", async ({ team, saison, title }) => {
    await renderAt(ROUTES.teamKader.path, team, saison, <TeamNotFound />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(title);
    expect(screen.getByRole("link", { name: COPY.shared.end.toOverview }).getAttribute("href")).toBe(ROUTES.area.path());
  });
});
