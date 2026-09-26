import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readPublishedDocument } from "@/core/openapiDocument.ts";
import { publishedCeilings } from "@/core/publishedCeilings.ts";

import type { PublishedDocument } from "@/core/publishedCeilings.ts";

/** One character ceiling a payload publishes, and the `maxlength` of every rendered box writing that field. */
type WidthAgainstBoxes = { field: string; bound: number; caps: (number | null)[] };

/**
 * Each `maxLength` the published `component` states on its own fields, beside every `<input>` in
 * `markup` whose `name` is exactly that field: `null` for a box capping nothing, and an empty list
 * where no box writes the field.
 */
function widthsAgainstBoxes(markup: string, component: string): WidthAgainstBoxes[] {
  const boxes = [...markup.matchAll(/<input\b([^>]*)>/g)].map((hit) => {
    const attrs = hit[1] ?? "";
    const cap = /(?<![-\w])maxlength="(\d+)"/i.exec(attrs)?.[1];

    return { name: /(?<![-\w])name="([^"]*)"/.exec(attrs)?.[1], cap: cap === undefined ? null : Number(cap) };
  });

  return publishedCeilings(readPublishedDocument() as PublishedDocument, [component])
    .filter(({ keyword }) => keyword === "maxLength")
    .map(({ field, bound }) => ({ field, bound, caps: boxes.filter(({ name }) => name === field).map(({ cap }) => cap) }));
}

/**
 * Read off the payload rather than listed, so a ceiling it publishes later is judged too. Uncapped, a
 * box lets the administrator type past what the save refuses, and they learn so only from the refusal.
 */
export function describeBoxCaps(subject: string, markup: string, component: string): void {
  const widths = widthsAgainstBoxes(markup, component);

  describe(`${subject} against the ceilings its payload publishes`, () => {
    it("finds a ceiling to judge", () => {
      assert.ok(widths.length > 0, `${component} publishes no character ceiling, so this render compares nothing`);
    });

    it("renders a box for every published ceiling", () => {
      // A ceiling on a field the render stopped writing would otherwise pass as having nothing to cap.
      assert.deepEqual(
        widths.filter(({ caps }) => caps.length === 0).map(({ field }) => field),
        [],
      );
    });

    for (const { field, bound, caps } of widths) {
      it(`caps every box writing ${field} at ${String(bound)}`, () => {
        assert.deepEqual(
          caps,
          caps.map(() => bound),
        );
      });
    }
  });
}
