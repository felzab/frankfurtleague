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
  it.each(["primary", "secondary", "danger", "icon"] as const)("takes its hover's colour as a %s button", (look) => {
    const classes = buttonLook({ look, host: "aria" });
    const hovered = under(classes, "data-hovered:");
    expect(hovered.length, "this look has no hover, so the case proves nothing").toBeGreaterThan(0);
    expect(under(classes, "data-pressed:")).toStrictEqual(hovered);
  });

  it.each(["primary", "secondary"] as const)("takes its hover's colour as a %s link", (look) => {
    const classes = buttonLook({ look, host: "link" });
    const hovered = under(classes, "hover:");
    expect(hovered.length, "the link has no hover, so the case proves nothing").toBeGreaterThan(0);
    expect(under(classes, "active:")).toStrictEqual(hovered);
  });
});
