// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";

import { Segmented, ToggleBoxes } from "./ChoiceButtons";
import { HeldForm } from "./HeldForm";

import type { Copy } from "@/core/copy";
import type { ReactElement } from "react";

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
        name="choice"
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
        name="choice"
        value={[]}
        choices={CHOICES}
      />,
    ],
  ] as const)("keeps a send that finds it empty, marking it invalid under the required line: %s", (_kind, role, field) => {
    const { container } = render(
      <HeldForm
        fieldErrors={undefined}
        rules={{ choice: { required: true } }}
        isBusy={false}
        onSend={() => undefined}>
        {field}
      </HeldForm>,
    );
    const group = screen.getByRole(role, { name: LABEL });
    const answers = within(group).getAllByRole(role === "radiogroup" ? "radio" : "checkbox");

    expect(answers.every((answer) => answer.hasAttribute("required"))).toBe(true);

    act(() => container.querySelector("form")?.requestSubmit());

    expect(group.getAttribute("data-invalid")).toBe("true");
    expect(screen.getByText(COPY.shared.field.required)).toBeTruthy();
  });
});

const CHOICE_KINDS = [
  [
    "a segmented choice",
    "radiogroup",
    () => (
      <Segmented
        label={LABEL}
        name="choice"
        value="yes"
        choices={CHOICES}
      />
    ),
  ],
  [
    "toggle boxes",
    "group",
    () => (
      <ToggleBoxes
        label={LABEL}
        name="choice"
        value={["yes"]}
        choices={CHOICES}
      />
    ),
  ],
] as const;

/** One choice in a form answering `fieldErrors`, as an editor's page holds its season's Stufen. */
function Answered({ field, fieldErrors }: { field: () => ReactElement; fieldErrors?: Readonly<Record<string, Copy>> }) {
  return (
    <HeldForm
      fieldErrors={fieldErrors}
      rules={{}}
      isBusy={false}
      onSend={() => undefined}>
      {field()}
    </HeldForm>
  );
}

// The harm: the server's refusal of a choice shown nowhere, or shown with the focus left where the press left it.
describe("a choice the server refuses", () => {
  it.each(CHOICE_KINDS)("stands under %s by the name it posts under, which takes the focus", (_kind, role, field) => {
    const { rerender } = render(<Answered field={field} />);

    rerender(
      <Answered
        field={field}
        fieldErrors={{ choice: COPY.shared.field.taken }}
      />,
    );

    const group = screen.getByRole(role, { name: LABEL });
    expect(group.getAttribute("data-invalid")).toBe("true");
    expect(within(group).getByText(COPY.shared.field.taken)).toBeTruthy();
    expect(group.contains(document.activeElement)).toBe(true);
  });
});
