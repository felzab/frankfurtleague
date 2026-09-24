import { readPublishedDocument } from "@/core/openapiDocument.ts";
import { publishedCeilings } from "@/core/publishedCeilings.ts";

import type { PublishedDocument } from "@/core/publishedCeilings.ts";

/** One character ceiling a payload publishes, and the `maxlength` of every rendered box writing that field. */
export type WidthAgainstBoxes = { field: string; bound: number; caps: (number | null)[] };

/**
 * Each `maxLength` the published `component` states on its own fields, beside every `<input>` in
 * `markup` whose `name` is exactly that field: `null` for a box capping nothing, and an empty list
 * where no box writes the field.
 */
export function widthsAgainstBoxes(markup: string, component: string): WidthAgainstBoxes[] {
  const boxes = [...markup.matchAll(/<input\b([^>]*)>/g)].map((hit) => {
    const attrs = hit[1] ?? "";
    const cap = /(?<![-\w])maxlength="(\d+)"/i.exec(attrs)?.[1];

    return { name: /(?<![-\w])name="([^"]*)"/.exec(attrs)?.[1], cap: cap === undefined ? null : Number(cap) };
  });

  return publishedCeilings(readPublishedDocument() as PublishedDocument, [component])
    .filter(({ keyword }) => keyword === "maxLength")
    .map(({ field, bound }) => ({ field, bound, caps: boxes.filter(({ name }) => name === field).map(({ cap }) => cap) }));
}
