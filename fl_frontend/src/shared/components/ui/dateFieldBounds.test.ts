import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { parseDate } from "@internationalized/date";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { Label } from "@heroui/react/label";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { AppDatePicker } = await import("./DateTimeFields.tsx");

/** Whether the opened calendar offers the day a reader would press, found by the name react-aria gives it. */
const offers = (day: RegExp): boolean =>
  within(screen.getByRole("dialog")).getByRole("button", { name: day }).getAttribute("aria-disabled") !== "true";

describe("the days a date field's calendar offers", () => {
  /* The field judges no bound (`AppDatePicker`'s `minValue` says why), so a bound the calendar is not
     handed leaves an illegal day pickable. */
  it("greys out every day outside the span the field is given, and offers both ends", async () => {
    const user = userEvent.setup();
    render(
      h(AppDatePicker, {
        name: "datum",
        label: h(Label, null, "Datum"),
        calendarLabel: "Datum auswählen",
        value: parseDate("2026-03-15"),
        onChange: () => undefined,
        minValue: parseDate("2026-03-10"),
        maxValue: parseDate("2026-03-20"),
      }),
    );

    await user.click(screen.getByRole("button"));

    assert.ok(!offers(/^Montag, 9\. März 2026/), "the calendar offers a day before the field's minimum");
    assert.ok(offers(/^Dienstag, 10\. März 2026/), "the calendar refuses the field's own minimum");
    assert.ok(offers(/^Freitag, 20\. März 2026/), "the calendar refuses the field's own maximum");
    assert.ok(!offers(/^Samstag, 21\. März 2026/), "the calendar offers a day after the field's maximum");
  });
});
