// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Segmented, ToggleBoxes } from "./ChoiceButtons";
import { HeldForm } from "./HeldForm";

const LABEL = COPY.shared.saison;
const CHOICES = [
  { id: "yes", label: COPY.shared.startelf },
  { id: "no", label: COPY.shared.bank },
];

// The harm: a required choice sent empty, which the form's own check lets through to the server.
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
  ] as const)("keeps a send that finds it empty, marking it invalid under the required line: %s", (_kind, role, field) => {
    const { container } = render(<HeldForm onSend={() => undefined}>{field}</HeldForm>);
    const group = screen.getByRole(role, { name: LABEL });
    const answers = within(group).getAllByRole(role === "radiogroup" ? "radio" : "checkbox");

    expect(answers.every((answer) => answer.hasAttribute("required"))).toBe(true);

    act(() => container.querySelector("form")?.requestSubmit());

    expect(group.getAttribute("data-invalid")).toBe("true");
    expect(screen.getByText(COPY.shared.field.required)).toBeTruthy();
  });
});
