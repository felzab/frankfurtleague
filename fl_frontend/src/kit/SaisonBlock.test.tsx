// @vitest-environment jsdom
import { getDefaultNormalizer, render, screen, within } from "@testing-library/react";
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

  it("shows the application window while no match is dated, with the way to apply", () => {
    render(
      <SaisonBlock
        title={TITLE}
        state={{ kind: "window", until: "2026-12-31", apply: "/bewerbung/2027" }}
      />,
    );
    // The default normalizer turns the line's no-break space into a plain one in the page's text and not in the
    // catalogue's, so the query keeps the whitespace as it stands.
    expect(
      screen.getByText(SERVER_COPY.landing.saison.windowUntil("2026-12-31"), {
        normalizer: getDefaultNormalizer({ collapseWhitespace: false }),
      }),
    ).toBeTruthy();
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
          last: [{ ...SPIEL, id: "1", result: { tore: { team1: 2, team2: 1 } } }],
          next: [{ ...SPIEL, id: "2", href: "/saisons/2027/spiele/2" }],
        }}
      />,
    );
    const heads = screen.getAllByRole("heading", { level: 3 }).map((head) => head.textContent);
    expect(heads).toStrictEqual([SERVER_COPY.landing.saison.last, SERVER_COPY.landing.saison.next]);
    const links = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(links).toStrictEqual(["/saisons/2027/spiele/1", "/saisons/2027/spiele/2"]);
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
});
