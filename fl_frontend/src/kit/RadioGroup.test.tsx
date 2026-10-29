// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form } from "react-aria-components/Form";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { RadioGroup } from "./RadioGroup";

/** The drawn part beside a label: the element the focus file rings. */
const drawnBox = (label: string) => {
  const box = screen.getByText(label).closest("label")?.querySelector("[data-kit-focus=box]");
  if (!(box instanceof HTMLElement)) throw new Error(`„${label}“ draws no box`);
  return box;
};

describe("a radio group", () => {
  // Read from the class, since jsdom draws nothing: the edge follows the group's invalid state, which only a
  // failed send reaches, so no look at the page shows it missing.
  it("draws every circle with the red edge once a send finds the required choice unmade, as a checkbox does", async () => {
    render(
      <Form onSubmit={(event) => event.preventDefault()}>
        <RadioGroup
          label={COPY.shared.saison}
          name="platz"
          isRequired
          choices={[
            { id: "startelf", label: COPY.shared.startelf },
            { id: "bank", label: COPY.shared.bank },
          ]}
        />
        <Button
          variant="primary"
          type="submit"
          label={COPY.shared.verb.speichern}
        />
      </Form>,
    );
    expect(drawnBox(COPY.shared.startelf).className.split(" ")).toContain("border-border-control");

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.speichern }));

    expect(screen.getByText(COPY.shared.feld.pflichtfeld)).toBeTruthy();
    for (const answer of [COPY.shared.startelf, COPY.shared.bank]) {
      expect(drawnBox(answer).className.split(" ")).toContain("border-danger");
      expect(drawnBox(answer).className.split(" ")).not.toContain("border-border-control");
    }
  });
});
