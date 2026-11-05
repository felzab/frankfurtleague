import { readFileSync } from "node:fs";
import path from "node:path";

import { filesUnder } from "@/test-support/treeWalk";
import { describe, expect, it } from "vitest";

/** A class filling under the pointer or a press with anything but the one layer, a group's or a peer's included. */
const OWN_FILL = /(?:^|[\s"'`])((?:[\w[\]/=-]+:)*[\w-]*(?:hover|hovered|pressed|active)[\w/-]*(?::[\w[\]/=-]+)*:bg-(?!layer\b)[^\s"'`]+)/g;

describe("the kit's hover", () => {
  // A control filling under the pointer with a colour of its own stands apart from every other control, and vanishes
  // on a ground of that colour, as the muted fill did on a card's head and under a row's hover; only an eye sees it.
  it("is the one layer in every kit file", () => {
    const sources = filesUnder(import.meta.dirname, (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name), 60);
    const found = sources.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(OWN_FILL)].map((match) => `${path.basename(file)}: ${match[1] ?? ""}`),
    );
    expect(found).toStrictEqual([]);
  });
});
