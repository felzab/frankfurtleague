// @vitest-environment jsdom
import { within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";
import { drawnOnServer } from "@/test-support/server";

import { ListPage } from "./ListPage";
import { SpielCards } from "./SpielCards";

import type { ComponentProps } from "react";

type Cards = Extract<ComponentProps<typeof ListPage>["list"], { kind: "cards" }>;

/** A page of cards as a browser holds it once its one read has landed. */
async function drawnCards(content: Awaited<Cards["content"]>) {
  const landed = await drawnOnServer(
    <ListPage
      head={{ scope: "saison", title: { route: "spielplan" } }}
      list={{ kind: "cards", content: Promise.resolve(content) }}
    />,
  );
  return { landed };
}

describe("a card of open work holding more than five rows", () => {
  // The harm: the card's count stops saying how many are open once the rows are cut to five.
  it("shows the count of all of them over the five it draws", async () => {
    const TITLE = COPY.page.spiele;
    const { landed } = await drawnCards({
      cards: [
        {
          id: "dates",
          title: TITLE,
          rows: Array.from({ length: 15 }, (_, index) => ({ id: String(index), href: "/", name: { record: `Spiel ${String(index + 1)}` } })),
        },
      ],
    });

    const card = within(landed).getByRole("heading", { name: TITLE }).closest("section") as HTMLElement;
    expect(within(card).getByText("15")).toBeDefined();
  });
});

describe("one club's matches under their matchdays", () => {
  /** The page as a browser holds it once its read has landed, its matches drawn as a team's Spiele page draws them. */
  async function drawn(groups: ComponentProps<typeof SpielCards>["groups"]) {
    const landed = await drawnOnServer(
      <ListPage
        head={{ scope: "area", title: { route: "teamSpiele" } }}
        list={{ kind: "drawn", content: Promise.resolve(<SpielCards groups={groups} />) }}
      />,
    );
    return { landed };
  }

  // The harm: a matchday's head a rung too low, so a screen reader's outline skips from the page's title to a third
  // level with no second between, and nothing on screen shows it.
  it("heads each matchday on the rung under the page's title", async () => {
    const head = COPY.shared.spieltag(1);
    const spiel = {
      id: "6890a1b2c3d4e5f607250021",
      when: COPY.spielplan.when(null, null),
      team1: { name: { record: "Heim" }, plaque: { record: "HEI" } },
      team2: { name: { record: "Gast" }, plaque: { record: "GAS" } },
    };
    const { landed } = await drawn([{ head, spiel }]);

    expect(landed.querySelector("h2")?.textContent).toBe(head);
    expect(landed.querySelector("h3")).toBeNull();
  });
});
