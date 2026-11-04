// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";
import { DAY_MS } from "@/core/timeUnits";

import { SaisonBlock } from "./SaisonBlock";

const TITLE = COPY.shared.saisonName("2027");
const SPIEL = {
  href: "/saisons/2027/spiele/1",
  when: COPY.spielplan.when("2027-03-13", "18:00"),
  team1: { name: { record: "Goethe" }, plaque: { record: "GOE" } },
  team2: { name: { record: "Helmholtz" }, plaque: { record: "HEL" } },
} as const;
const OPENING = {
  when: SPIEL.when,
  spieltag: SERVER_COPY.landing.saison.spieltag(1),
  team1: { record: "GOE" },
  team2: { record: "HEL" },
} as const;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2027-03-01T17:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the season's card before the start", () => {
  it("counts down to the season's start from the server's clock, and names when its opening match kicks off", () => {
    render(
      <SaisonBlock
        title={TITLE}
        state={{ kind: "countdown", start: new Date(Date.now() + 12 * DAY_MS).toISOString(), opening: OPENING }}
      />,
    );
    const timer = screen.getByRole("timer");
    expect(timer.textContent).toBe(`12${COPY.landing.saison.days}0${COPY.landing.saison.hours}0${COPY.landing.saison.minutes}`);
    expect(screen.getByText(SERVER_COPY.landing.saison.opening(SPIEL.when))).toBeTruthy();
  });

  // The opening match by its plaques alone, so the line a phone shows never wraps.
  it("names the opening match by its matchday and its two plaques, without the clubs' names", () => {
    render(
      <SaisonBlock
        title={TITLE}
        state={{ kind: "countdown", start: new Date(Date.now() + DAY_MS).toISOString(), opening: OPENING }}
      />,
    );
    const line = screen.getByText(OPENING.spieltag).parentElement;
    expect(line?.textContent).toBe(`${OPENING.spieltag}GOE–HEL`);
    expect(screen.queryByText(SPIEL.team1.name.record)).toBe(null);
  });

  // The dashed open plaque holds no text, so the Spielplan's words for an open side name it to a screen reader.
  it("names an empty opening side to a screen reader, as the Spielplan does", () => {
    render(
      <SaisonBlock
        title={TITLE}
        state={{ kind: "countdown", start: new Date(Date.now() + DAY_MS).toISOString(), opening: { ...OPENING, team2: null } }}
      />,
    );
    const line = screen.getByText(OPENING.spieltag).parentElement;
    expect(line?.textContent).toBe(`${OPENING.spieltag}GOE–${COPY.spielplan.quelle.open}`);
    expect(within(line as HTMLElement).getByText(COPY.spielplan.quelle.open).classList).toContain("sr-only");
  });

  // The countdown always shows, the season's start being its one instant; only the opening match waits on a dated fixture.
  it("counts down alone while no match is dated", () => {
    render(
      <SaisonBlock
        title={TITLE}
        state={{ kind: "countdown", start: new Date(Date.now() + DAY_MS).toISOString() }}
      />,
    );
    expect(screen.getByRole("timer").textContent).toBe(
      `1${COPY.landing.saison.days}0${COPY.landing.saison.hours}0${COPY.landing.saison.minutes}`,
    );
    expect(screen.queryByText(SERVER_COPY.landing.saison.spieltag(1))).toBe(null);
    expect(screen.queryByText(SERVER_COPY.landing.saison.opening(SPIEL.when))).toBe(null);
  });

  it("shows the application window while no match is dated, with the way to apply", () => {
    render(
      <SaisonBlock
        title={TITLE}
        state={{ kind: "window", until: "2026-12-31", apply: "/bewerbung/2027" }}
      />,
    );
    expect(screen.getByText(SERVER_COPY.landing.saison.windowUntil("2026-12-31"))).toBeTruthy();
    expect(screen.getByRole("link", { name: SERVER_COPY.landing.toBewerbung }).getAttribute("href")).toBe("/bewerbung/2027");
    expect(screen.queryByRole("timer")).toBe(null);
  });
});

describe("the season's card while it runs", () => {
  it("lists its last result and its next match, each under its own head", () => {
    render(
      <SaisonBlock
        title={TITLE}
        state={{
          kind: "running",
          last: { ...SPIEL, id: "1", result: { tore: { team1: 2, team2: 1 } } },
          next: { ...SPIEL, id: "2", href: "/saisons/2027/spiele/2" },
        }}
      />,
    );
    const heads = screen.getAllByRole("heading", { level: 3 }).map((head) => head.textContent);
    expect(heads).toStrictEqual([SERVER_COPY.landing.saison.last, SERVER_COPY.landing.saison.next]);
    const links = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(links).toStrictEqual(["/saisons/2027/spiele/1", "/saisons/2027/spiele/2"]);
  });

  it("leaves out the head of a match it does not have, as before the first result", () => {
    render(
      <SaisonBlock
        title={TITLE}
        state={{ kind: "running", next: { ...SPIEL, id: "2" } }}
      />,
    );
    expect(screen.queryByText(SERVER_COPY.landing.saison.last)).toBe(null);
    expect(screen.getByText(SERVER_COPY.landing.saison.next)).toBeTruthy();
  });
});

describe("the season's card once decided", () => {
  it("reads places 1 to 3 in their order, and place 4 in the row under them", () => {
    render(
      <SaisonBlock
        title={TITLE}
        state={{
          kind: "decided",
          places: [
            { name: { record: "Liebig" }, plaque: { record: "LIE" } },
            { name: { record: "Elisabethen" }, plaque: { record: "ELI" } },
            { name: { record: "Ernst-Reuter" }, plaque: { record: "ERS" } },
            { name: { record: "Carlo-Mierendorff" }, plaque: { record: "CMS" } },
          ],
        }}
      />,
    );
    const podium = screen.getByRole("list");
    expect(
      within(podium)
        .getAllByRole("listitem")
        .map((place) => place.textContent),
    ).toStrictEqual(["LIELiebig1", "ELIElisabethen2", "ERSErnst-Reuter3"]);
    expect(screen.getByText(SERVER_COPY.landing.saison.place(4)).parentElement?.textContent).toBe(
      `${SERVER_COPY.landing.saison.place(4)}CMSCarlo-Mierendorff`,
    );
  });

  // A place left vacant keeps its step or row, the dashed plaque and its label in the name's stead, so it reads as a
  // place without a club.
  it("labels a vacant step and a vacant fourth place in the club's stead", () => {
    render(
      <SaisonBlock
        title={TITLE}
        state={{
          kind: "decided",
          places: [
            { name: { record: "Liebig" }, plaque: { record: "LIE" } },
            null,
            { name: { record: "Carlo-Mierendorff" }, plaque: { record: "CMS" } },
            null,
          ],
        }}
      />,
    );
    const vacant = SERVER_COPY.landing.saison.vacant;
    expect(
      within(screen.getByRole("list"))
        .getAllByRole("listitem")
        .map((place) => place.textContent),
    ).toStrictEqual(["LIELiebig1", `${COPY.shared.noValue}${vacant}2`, "CMSCarlo-Mierendorff3"]);
    expect(screen.getByText(SERVER_COPY.landing.saison.place(4)).parentElement?.textContent).toBe(
      `${SERVER_COPY.landing.saison.place(4)}${COPY.shared.noValue}${vacant}`,
    );
  });
});
