// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";

import { ComboBox } from "./ComboBox";

describe("a combo box's arrow", () => {
  // The harm: a screen reader hears React Aria's own wording on a box taking no free text, a phrase no other box says.
  it("is named by the catalogue in a box taking no free text", () => {
    render(
      <ComboBox
        label={COPY.shared.schiedsrichter}
        options={[{ id: "lena", label: { record: "Lena Berg" } }]}
      />,
    );
    // React Aria names the button by its own label, then the field's.
    expect(screen.getByRole("button", { name: `${COPY.shared.showSuggestions} ${COPY.shared.schiedsrichter}` })).toBeTruthy();
  });
});
