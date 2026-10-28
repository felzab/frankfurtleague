// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form } from "react-aria-components/Form";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { DateField } from "./DateField";
import { TimeField } from "./TimeField";

import type { Kalendertag } from "@/core/format";

function Datum({ tag }: { tag: Kalendertag }) {
  return (
    <Form onSubmit={(event) => event.preventDefault()}>
      <DateField
        label={COPY.seite.spiele}
        name="datum"
        defaultValue={tag}
        minValue="2026-09-01"
        maxValue="2027-06-30"
      />
      <Button
        variant="primary"
        type="submit"
        label={COPY.shared.verb.speichern}
      />
    </Form>
  );
}

/** The element a field rings as a whole: a date's group with its button, a time's segments. */
const frameOf = (label: string) => {
  const frame = screen.getByText(label).parentElement?.querySelector("[data-kit-focus=field]");
  if (!(frame instanceof HTMLElement)) throw new Error(`„${label}“ draws no field`);
  return frame.className.split(" ");
};

describe("a date's and a time's width", () => {
  it("holds a date's ten characters beside its calendar button, 10 px in from its start", () => {
    render(<Datum tag="2026-10-01" />);
    expect(frameOf(COPY.seite.spiele)).toEqual(
      expect.arrayContaining(["w-[calc(11ch+1.375rem+2.25rem)]", "pointer-coarse:w-[calc(11ch+1.375rem+2.75rem)]", "ps-2.5"]),
    );
  });

  it("holds a time's five characters, 10 px in on either side", () => {
    render(<TimeField label={COPY.seite.spiele} />);
    expect(frameOf(COPY.seite.spiele)).toEqual(expect.arrayContaining(["w-[calc(6ch+1.375rem)]", "px-2.5"]));
  });
});

describe("a date outside its bounds", () => {
  it("says the earliest day it takes", async () => {
    render(<Datum tag="2026-08-31" />);
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.speichern }));
    expect(screen.getByText(COPY.shared.feld.fruehestens("2026-09-01"))).toBeTruthy();
  });

  it("says the latest day it takes", async () => {
    render(<Datum tag="2027-07-01" />);
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.speichern }));
    expect(screen.getByText(COPY.shared.feld.spaetestens("2027-06-30"))).toBeTruthy();
  });
});
