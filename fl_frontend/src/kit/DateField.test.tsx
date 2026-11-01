// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form } from "react-aria-components/Form";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { DateField } from "./DateField";

import type { CalendarDay } from "@/core/format";

function Field({ day }: { day: CalendarDay }) {
  return (
    <Form onSubmit={(event) => event.preventDefault()}>
      <DateField
        label={COPY.page.spiele}
        name="datum"
        defaultValue={day}
        minValue="2026-09-01"
        maxValue="2027-06-30"
      />
      <Button
        variant="primary"
        type="submit"
        label={COPY.shared.verb.save}
      />
    </Form>
  );
}

describe("a date outside its bounds", () => {
  it("says the earliest day it takes", async () => {
    render(<Field day="2026-08-31" />);
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));
    expect(screen.getByText(COPY.shared.field.earliest("2026-09-01"))).toBeTruthy();
  });

  it("says the latest day it takes", async () => {
    render(<Field day="2027-07-01" />);
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));
    expect(screen.getByText(COPY.shared.field.latest("2027-06-30"))).toBeTruthy();
  });
});
