// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Tick } from "./Checkbox";

describe("a box alone in a column", () => {
  // The harm: a column of boxes a screen reader says as „Kontrollkästchen“ fourteen times, each drawing as it should.
  it("is named by its column's head and its row's name, and asks its owner of a press while it is locked", async () => {
    const onChange = vi.fn();
    render(
      <>
        <span id="head">{COPY.shared.startelf}</span>
        <span id="row">{COPY.shared.kader}</span>
        <Tick
          aria-labelledby="head row"
          isSelected={false}
          locked
          onChange={onChange}
        />
      </>,
    );

    await userEvent.click(screen.getByRole("checkbox", { name: `${COPY.shared.startelf} ${COPY.shared.kader}` }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
  });
});
