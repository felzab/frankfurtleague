import { readFileSync } from "node:fs";
import path from "node:path";

import { filesUnder } from "@/test-support/treeWalk";
import { describe, expect, it } from "vitest";

import { buttonLook } from "./buttonStyles";

/** The classes behind one state's prefix, its prefix taken off. */
const under = (classes: string, prefix: string) =>
  classes
    .split(" ")
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length))
    .sort();

describe("a button pressed", () => {
  it.each(["primary", "secondary", "danger", "icon", "quiet"] as const)("takes its hover's colour as a %s button", (look) => {
    const classes = buttonLook({ look, host: "aria" });
    const hovered = under(classes, "data-hovered:");
    expect(hovered.length, "this look has no hover, so the case proves nothing").toBeGreaterThan(0);
    expect(under(classes, "data-pressed:")).toStrictEqual(hovered);
  });

  it.each(["primary", "secondary", "icon", "quiet"] as const)("takes its hover's colour as a %s link", (look) => {
    const classes = buttonLook({ look, host: "link" });
    const hovered = under(classes, "hover:");
    expect(hovered.length, "the link has no hover, so the case proves nothing").toBeGreaterThan(0);
    expect(under(classes, "active:")).toStrictEqual(hovered);
  });
});

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
