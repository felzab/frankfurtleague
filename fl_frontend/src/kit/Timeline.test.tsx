// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import { Timeline } from "./Timeline";

describe("a timeline", () => {
  it("lists its checkpoints in order, each mark read with its title, its content under them", () => {
    render(
      <Timeline
        label={COPY.page.spiele}
        items={[
          {
            id: "e1",
            mark: { record: "12" },
            title: SERVER_COPY.season.spiel.event(SERVER_COPY.season.spiel.tor, { record: "Mika Brandt" }),
            detail: { record: "AHO · 1:0" },
          },
          {
            id: "e2",
            mark: { record: "90+3" },
            title: SERVER_COPY.season.spiel.event(SERVER_COPY.season.spiel.karte.gelb, { record: "Leon Hartmann" }),
            children: <p>Foulspiel</p>,
          },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: COPY.page.spiele });
    // The minute is the one place a goal's time stands, so assistive technology reads it with the title.
    const read = within(list)
      .getAllByRole("listitem")
      .map((item) =>
        [...item.querySelectorAll(":scope span, :scope p")]
          .filter((part) => part.closest("[aria-hidden]") === null)
          .map((part) => part.textContent),
      );
    expect(read).toEqual([
      ["12", "Tor · Mika Brandt", "AHO · 1:0"],
      ["90+3", "Gelbe Karte · Leon Hartmann", "Foulspiel"],
    ]);
  });
});
