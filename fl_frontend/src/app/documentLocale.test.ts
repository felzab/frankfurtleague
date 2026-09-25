import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { parseDate } from "@internationalized/date";

import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

/* Next's font loader runs only inside its own build, so the layout's three faces load as inert ones:
   what is read here is the document's language and the fields under it, which no face decides. */
const FONTS = `const face = () => ({ className: "", variable: "", style: { fontFamily: "" } });
export { face as Anton, face as Inter, face as Raleway };`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "next/font/google") return nextResolve(specifier, context);

    return { url: `data:text/javascript,${encodeURIComponent(FONTS)}`, shortCircuit: true };
  },
});

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
    // react-aria wraps a date in Unicode isolates, which the language's own formatter does not.
    const shown = textOf(html).replace(/[\u2066-\u2069]/g, "");
    assert.ok(shown.includes(expected), `the document declares lang="${lang}", whose ${expected} the field does not show: ${shown}`);
  });
});
