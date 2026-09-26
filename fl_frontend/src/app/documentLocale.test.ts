import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { parseDate } from "@internationalized/date";

import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

const { default: RootLayout } = await import("./layout.tsx");
const { AppDatePicker } = await import("@/shared/components/ui/DateTimeFields.tsx");

/** A day whose two numbers differ, so a field ordering them by another calendar reads otherwise. */
const DAY = "2016-09-04";

describe("the document's locale", () => {
  /* What fails a visitor is the two DISAGREEING — a de-DE pin under lang="en" is as wrong as an
     unpinned field under lang="de" — so the field is held to the document's language, not a literal. */
  it("formats a date field under the root layout in the language the document declares", () => {
    const html = renderTree(
      underNext(
        h(RootLayout, {
          children: h(AppDatePicker, {
            name: "datum",
            label: "Datum",
            calendarLabel: "Datum auswählen",
            value: parseDate(DAY),
            onChange: () => undefined,
          }),
        }),
      ),
    );

    const lang = /<html\b[^>]*\slang="([^"]+)"/.exec(html)?.[1];
    assert.ok(lang !== undefined, "the root layout renders <html> without a lang attribute");

    const expected = new Intl.DateTimeFormat(lang, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${DAY}T12:00:00Z`),
    );
    const shown = textOf(html);
    assert.ok(shown.includes(expected), `the document declares lang="${lang}", whose ${expected} the field does not show: ${shown}`);
  });
});
