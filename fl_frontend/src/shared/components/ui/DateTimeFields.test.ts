import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { parseDate, parseTime } from "@internationalized/date";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { Label } from "@heroui/react/label";
import { I18nProvider } from "@heroui/react/rac";

import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { ReactNode } from "react";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { AppDatePicker, AppTimeField } = await import("./DateTimeFields.tsx");
const { Form } = await import("./Form.tsx");

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

describe("a refusal the server put on a date or time field", () => {
  const REFUSAL = "Dieser Wert wurde abgelehnt.";

  /* Each call parses afresh, as every caller's render does from its draft's text. */
  const FIELDS: [string, () => ReactNode][] = [
    [
      "date",
      () =>
        h(AppDatePicker, {
          name: "datum",
          label: h(Label, null, "Datum"),
          calendarLabel: "Datum auswählen",
          value: parseDate("2026-08-12"),
          onChange: () => undefined,
        }),
    ],
    [
      "time",
      () => h(AppTimeField, { name: "uhrzeit", label: h(Label, null, "Anpfiff"), value: parseTime("18:30"), onChange: () => undefined }),
    ],
  ];

  for (const [kind, field] of FIELDS) {
    /* react-aria takes the refusal off on a blur whose value is another object than at the focus, and an
       editor that judges nothing on blur never puts it back. */
    it(`stays on the ${kind} through a visit that re-renders it and changes nothing`, async () => {
      // Held across renders: a new map is a new refusal, which re-arms the field by itself.
      const refused = { datum: REFUSAL, uhrzeit: REFUSAL };
      const tree = () =>
        h(I18nProvider, {
          locale: "de-DE",
          children: h(
            Form,
            { onSubmit: () => undefined, schemas: [], validationErrors: refused },
            field(),
            h("button", { type: "button" }, "Weiter"),
          ),
        });
      const user = userEvent.setup();
      const { container, rerender, unmount } = render(tree());
      assert.equal(screen.queryAllByText(REFUSAL).length, 1, "the refusal never reached the field, so the visit below is judged on nothing");

      const segment = container.querySelector<HTMLElement>('[role="spinbutton"]') ?? assert.fail(`the ${kind} renders no segment`);
      await act(async () => segment.focus());
      rerender(tree());
      await user.click(screen.getByRole("button", { name: "Weiter" }));

      assert.equal(screen.queryAllByText(REFUSAL).length, 1, "a visit that changed nothing took the refusal off the field");
      unmount();
    });
  }
});
