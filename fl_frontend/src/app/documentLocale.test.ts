// @vitest-environment jsdom
import { createElement as h } from "react";

import { parseDate } from "@internationalized/date";
import { renderToStaticMarkup } from "react-dom/server";
import { assert, describe, expect, it, vi } from "vitest";

// Next's font loader runs only inside its own build; nothing asserted here is decided by a face.
vi.mock("next/font/google", () => {
  const face = () => ({ className: "", variable: "", style: { fontFamily: "" } });
  return { Anton: face, Inter: face, Raleway: face };
});
// The root providers hand Next's router to React Aria's links; outside a mounted app router the
// real hook throws, and nothing here navigates.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

const { default: RootLayout } = await import("./layout.tsx");
const { AppDatePicker } = await import("@/shared/components/ui/DateTimeFields.tsx");

/** A day whose two numbers differ, so a field ordering them by another calendar reads otherwise. */
const DAY = "2016-09-04";

describe("the document's locale", () => {
  /* What fails a visitor is the two DISAGREEING — a de-DE pin under lang="en" is as wrong as an
     unpinned field under lang="de" — so the field is held to the document's language, not a literal. */
  it("formats a date field under the root layout in the language the document declares", () => {
    const html = renderToStaticMarkup(
      h(RootLayout, {
        children: h(AppDatePicker, {
          name: "datum",
          label: "Datum",
          calendarLabel: "Datum auswählen",
          value: parseDate(DAY),
          onChange: () => undefined,
        }),
      }),
    );

    const lang = /<html\b[^>]*\slang="([^"]+)"/.exec(html)?.[1];
    assert(lang !== undefined, "the root layout renders <html> without a lang attribute");

    const expected = new Intl.DateTimeFormat(lang, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${DAY}T12:00:00Z`),
    );
    // The segments each render in an element of their own, so the text is read from the parsed document.
    const shown = new DOMParser().parseFromString(html, "text/html").documentElement.textContent;
    expect(shown, `the document declares lang="${lang}", whose ${expected} the field does not show`).toContain(expected);
  });
});
