// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form } from "react-aria-components/Form";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { DateField } from "./DateField";

import type { CalendarDay } from "@/core/format";

function Datum({ tag }: { tag: CalendarDay }) {
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
