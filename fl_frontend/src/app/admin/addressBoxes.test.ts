import { readFileSync } from "node:fs";
import path from "node:path";

import { filesUnder } from "@/test-support/treeWalk.ts";
import { describe, expect, it } from "vitest";

const SEATS = path.join(import.meta.dirname, "../../features/teams/components/forms/SeatActs.tsx");

const SOURCES = [...filesUnder(import.meta.dirname, (name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"), 40), SEATS];

// The harm: the address of a person being erased or banned stays in the administrator's browser and is offered to the
// next form, which nothing shows. Read from the source, since a page's box stands behind its session and its reads.
describe("an administration's address box", () => {
  it("offers and keeps no autofill", () => {
    const boxes = SOURCES.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/kind(?:=|: )"email",?\n\s*(.*)/g)].map((box) => `${path.basename(file)}: ${box[1] ?? ""}`),
    );

    expect(boxes.length).toBeGreaterThanOrEqual(8);
    expect(boxes.filter((box) => !box.includes('autofill="off"') && !box.includes('autofill: "off"'))).toStrictEqual([]);
  });
});
