import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { parseDate, parseTime } from "@internationalized/date";

import { Label } from "@heroui/react/label";
import { I18nProvider } from "@heroui/react/rac";

import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { ReactNode } from "react";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { AppDatePicker, AppTimeField } = await import("./DateTimeFields.tsx");

/** The locale `fl_frontend/src/core/providers/RootProviders.tsx` pins, whose own short pattern pads no day, month or hour. */
const inGerman = (field: ReactNode) => textOf(renderTree(h(I18nProvider, { locale: "de-DE", children: field })));

describe("what a date or time field shows for a value it holds", () => {
  it("writes a single-digit day and month with two digits, as every date the app prints", () => {
    const shown = inGerman(
      h(AppDatePicker, {
        name: "datum",
        label: h(Label, null, "Datum"),
        calendarLabel: "Datum auswählen",
        value: parseDate("2016-09-04"),
        onChange: () => undefined,
      }),
    );

    assert.match(shown, /04\.09\.2016/, `the field reads ${shown}`);
  });

  it("writes a single-digit hour with two digits, as every kick-off the app prints", () => {
    const shown = inGerman(
      h(AppTimeField, {
        name: "uhrzeit",
        label: h(Label, null, "Anpfiff"),
        value: parseTime("09:05"),
        onChange: () => undefined,
      }),
    );

    // react-aria wraps a time in Unicode isolates, so the digits are matched rather than the whole text.
    assert.match(shown, /(?<!\d)09:05/, `the field reads ${shown}`);
  });
});
