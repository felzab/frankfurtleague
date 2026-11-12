// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { CappedRows } from "./CappedRows";

/** A card's body of `count` rows, each opening its record by its link, as a card of open work holds them. */
const body = (count: number) => (
  <div>
    <CappedRows
      rows={Array.from({ length: count }, (_, index) => (
        <div key={index}>
          <a href={`/spiel/${String(index + 1)}`}>{`Spiel ${String(index + 1)}`}</a>
        </div>
      ))}
    />
  </div>
);

describe("a card's capped rows", () => {
  // The harm: the press shows the rest and leaves the focus on the button it removed, so a keyboard or a screen reader
  // starts over from the page's top; or rows stay hidden after it.
  it("show the rest in place on „Alle anzeigen“, the focus on the first row it showed", async () => {
    render(body(15));
    expect(screen.getAllByRole("link")).toHaveLength(5);

    await userEvent.click(screen.getByRole("button", { name: COPY.template.showAll }));

    expect(screen.getAllByRole("link")).toHaveLength(15);
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Spiel 6" }));
  });

  // The harm: a card at its cap ends in a button that shows nothing.
  it("show every row of a card holding five, with no button", () => {
    render(body(5));

    expect(screen.getAllByRole("link")).toHaveLength(5);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
