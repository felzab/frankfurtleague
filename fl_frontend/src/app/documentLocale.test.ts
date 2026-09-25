import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { parseDate } from "@internationalized/date";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
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

const SRC_DIR = path.resolve(import.meta.dirname, "..");

/** Every component the tree ships that mounts react-aria's locale provider. */
const mounts = filesUnder(SRC_DIR, (name) => name.endsWith(".tsx") && !isTestFile(name), 200)
  .filter((file) => readFileSync(file, "utf8").includes("<I18nProvider"))
  .map((file) => path.relative(SRC_DIR, file).split(path.sep).join("/"));

/** A day whose two numbers differ, so a field ordering them by another calendar reads otherwise. */
const DAY = "2016-09-04";

describe("the document's locale", () => {
  // react-aria reads the NEAREST provider, so a second mount is a subtree formatting dates by
  // whatever it pins, under the language the document declares. No render reaches every subtree.
  it("is pinned exactly once", () => {
    assert.equal(mounts.length, 1, `expected one <I18nProvider> mount, found ${String(mounts.length)}: ${mounts.join(", ")}`);
  });

  /* What fails a visitor is the two DISAGREEING — a de-DE pin under lang="en" is as wrong as an
     unpinned field under lang="de" — so the field is held to the language the rendered document
     declares rather than to a literal. */
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
    const shown = textOf(html).replace(/[⁦-⁩]/g, "");
    assert.ok(shown.includes(expected), `the document declares lang="${lang}", whose ${expected} the field does not show: ${shown}`);
  });
});
