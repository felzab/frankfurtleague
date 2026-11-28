// @vitest-environment jsdom
import { useState } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";
import { dayBefore } from "@/core/dayArithmetic";

import { DateField } from "./DateField";
import { HeldForm } from "./HeldForm";

import type { CalendarDay } from "@/core/format";

/** A span's end held to the day before its start, as a season's registration window is, the start typed beside it. */
function Window() {
  const [start, setStart] = useState<CalendarDay | null>("2026-11-01");
  return (
    <HeldForm
      fieldErrors={undefined}
      rules={{}}
      isBusy={false}
      onSend={() => undefined}>
      <DateField
        label={COPY.shared.name}
        name="start"
        value={start}
        onChange={setStart}
      />
      <DateField
        label={COPY.shared.emailAddress}
        name="end"
        defaultValue="2027-04-16"
        {...(start === null ? {} : { maxValue: dayBefore(start) })}
      />
      <button type="submit">{COPY.shared.verb.save}</button>
    </HeldForm>
  );
}

// The harm: a box stays marked for a bound its value meets, through every later press and a save that goes through, so
// an administrator distrusts the save or changes a date that was right.
describe("a date held to a bound another box sets", () => {
  it("keeps the bound's mark while its value breaks the moved bound, and loses it once it meets it", async () => {
    const { container } = render(<Window />);
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));
    expect(container.textContent).toContain(COPY.shared.field.latest("2026-10-31"));

    // The start's month, to December 2026: the end's 16.04.2027 still stands after it.
    const [, month] = screen.getAllByRole("spinbutton");
    await userEvent.click(month as HTMLElement);
    await userEvent.keyboard("12");
    expect(container.textContent).toContain(COPY.shared.field.latest("2026-11-30"));

    // The focus has moved on to the start's year, to 2028: the end now stands before it.
    await userEvent.keyboard("2028");
    expect(container.textContent).not.toContain(COPY.shared.field.latest("2028-11-30"));
    expect(container.querySelector("[data-invalid]")).toBeNull();
  });
});
