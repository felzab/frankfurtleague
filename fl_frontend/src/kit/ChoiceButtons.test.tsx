// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Segmented, ToggleBoxes } from "./ChoiceButtons";
import { HeldForm } from "./HeldForm";

const LABEL = COPY.shared.saison;
const CHOICES = [
  { id: "ja", label: COPY.shared.startelf },
  { id: "nein", label: COPY.shared.bank },
];

// The harm: a required choice heard as optional, and one the send refused heard as nothing wrong, while the page shows
// the asterisk and the red edge; only a screen reader misses it, and nothing fails.
describe("a required short choice", () => {
  it.each([
    [
      "a segmented choice",
      "radiogroup",
      <Segmented
        key="segmented"
        label={LABEL}
        isRequired
        value={null}
        choices={CHOICES}
      />,
    ],
    [
      "toggle boxes",
      "group",
      <ToggleBoxes
        key="boxes"
        label={LABEL}
        isRequired
        value={[]}
        choices={CHOICES}
      />,
    ],
  ] as const)("is heard as required, then as invalid once the send finds it empty: %s", (_kind, role, field) => {
    const { container } = render(<HeldForm onSend={() => undefined}>{field}</HeldForm>);
    const group = screen.getByRole(role, { name: LABEL });
    const answers = within(group).getAllByRole(role === "radiogroup" ? "radio" : "checkbox");

    expect(answers.every((answer) => answer.hasAttribute("required"))).toBe(true);

    act(() => container.querySelector("form")?.requestSubmit());

    expect(group.getAttribute("data-invalid")).toBe("true");
    expect(screen.getByText(COPY.shared.field.required)).toBeTruthy();
  });

  it("is heard as invalid, described by the served refusal", () => {
    render(
      <Segmented
        label={LABEL}
        isRequired
        value={null}
        choices={CHOICES}
        errorMessage={COPY.shared.field.required}
      />,
    );

    expect(screen.getByRole("radiogroup", { name: LABEL }).getAttribute("aria-invalid")).toBe("true");
    for (const answer of screen.getAllByRole("radio")) {
      expect(answer.getAttribute("aria-describedby")).toBe(screen.getByText(COPY.shared.field.required).id);
    }
  });
});
