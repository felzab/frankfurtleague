// @vitest-environment jsdom
import { within } from "@testing-library/react";
import { prerender } from "react-dom/static";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { ListPage } from "./ListPage";

import type { ComponentProps } from "react";

type Cards = Extract<ComponentProps<typeof ListPage>["list"], { kind: "cards" }>;

/** A page of cards as a browser holds it once its one read has landed. */
async function drawnCards(content: Awaited<Cards["content"]>) {
  const { prelude } = await prerender(
    <ListPage
      head={{ scope: "saison", title: { route: "spielplan" } }}
      list={{ kind: "cards", content: Promise.resolve(content) }}
    />,
  );
  const landed = document.createElement("div");
  landed.innerHTML = await new Response(prelude).text();
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

describe("a page of one card holding a list", () => {
  const TITLE = COPY.page.spiele;
  const drawn = (rows: Awaited<Cards["content"]>["cards"][number]["rows"]) =>
    drawnCards({ cards: [{ id: "spiele", title: TITLE, rows, count: false, empty: { kind: "none", plural: TITLE } }] });

  // The harm: a list with nothing in it yet under „Nichts offen.“ tells a referee their work is done, where none is booked.
  it("gives way to the list's own empty state", async () => {
    const { landed } = await drawn([]);

    // Its text alone: the card's title before it would say the card still stands.
    expect(landed.querySelector("main")?.textContent).toBe(COPY.shared.empty.none(TITLE));
  });
});

describe("one club's matches under their matchdays", () => {
  type Groups = Extract<ComponentProps<typeof ListPage>["list"], { kind: "spielGroups" }>;

  /** The page as a browser holds it once its read has landed. */
  async function drawn(content: Awaited<Groups["content"]>) {
    const { prelude } = await prerender(
      <ListPage
        head={{ scope: "area", title: { route: "teamSpiele" } }}
        list={{ kind: "spielGroups", content: Promise.resolve(content) }}
      />,
    );
    const landed = document.createElement("div");
    landed.innerHTML = await new Response(prelude).text();
    return { landed };
  }

  const EMPTY = { kind: "none", plural: COPY.page.spiele } as const;

  // The harm: a season before its draw drawn as an empty box, which reads as a list that failed to load.
  it("gives way to the list's own empty state", async () => {
    const { landed } = await drawn({ groups: [], empty: EMPTY });

    expect(landed.querySelector("main")?.textContent).toBe(COPY.shared.empty.none(COPY.page.spiele));
  });
});
