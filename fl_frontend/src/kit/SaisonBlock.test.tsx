// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { DAY_MS } from "@/core/timeUnits";

import { SaisonBlock } from "./SaisonBlock";

const TITLE = COPY.shared.saisonName("2027");
const SPIEL = {
  href: "/saisons/2027/spiele/1",
  when: "Sa., 13.03. · 18:00",
  home: { name: "Goethe", plaque: { kuerzel: "GOE" } },
  away: { name: "Helmholtz", plaque: { kuerzel: "HEL" } },
} as const;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2027-03-01T17:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the season's card before the start", () => {
  it("counts down to the first kick-off once one is dated, from the server's clock", () => {
    render(
      <SaisonBlock
        title={TITLE}
        state={{ kind: "countdown", kickoff: new Date(Date.now() + 12 * DAY_MS).toISOString(), when: SPIEL.when }}
      />,
    );
    const timer = screen.getByRole("timer");
    expect(timer.textContent).toBe(`12${COPY.landing.saison.days}0${COPY.landing.saison.hours}0${COPY.landing.saison.minutes}`);
    expect(screen.getByText(COPY.landing.saison.kickoff(SPIEL.when))).toBeTruthy();
  });

  it("shows the application window while no match is dated, with the way to apply", () => {
    render(
      <SaisonBlock
        title={TITLE}
        state={{ kind: "window", until: "2026-12-31", apply: "/bewerbung/2027" }}
      />,
    );
    expect(screen.getByText(COPY.landing.saison.windowUntil("2026-12-31"))).toBeTruthy();
    expect(screen.getByRole("link", { name: COPY.landing.applyNow }).getAttribute("href")).toBe("/bewerbung/2027");
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
    expect(heads).toStrictEqual([COPY.landing.saison.last, COPY.landing.saison.next]);
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
    expect(screen.queryByText(COPY.landing.saison.last)).toBe(null);
    expect(screen.getByText(COPY.landing.saison.next)).toBeTruthy();
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
            { name: "Liebig", kuerzel: "LIE" },
            { name: "Elisabethen", kuerzel: "ELI" },
            { name: "Ernst-Reuter", kuerzel: "ERS" },
            { name: "Carlo-Mierendorff", kuerzel: "CMS" },
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
    expect(screen.getByText(COPY.landing.saison.place(4)).parentElement?.textContent).toBe(
      `${COPY.landing.saison.place(4)}CMSCarlo-Mierendorff`,
    );
  });
});
