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

  it("takes its hover's colour as the primary link", () => {
    const classes = buttonLook({ look: "primary", host: "link" });
    const hovered = under(classes, "hover:");
    expect(hovered.length, "the link has no hover, so the case proves nothing").toBeGreaterThan(0);
    expect(under(classes, "active:")).toStrictEqual(hovered);
  });
});

describe("a labelled button", () => {
  it.each(["primary", "secondary", "danger"] as const)("keeps 14 px either side of a %s button's label", (look) => {
    expect(buttonLook({ look, host: "aria" }).split(" ")).toContain("px-3.5");
  });
});

describe("a button's fills", () => {
  it("hovers a secondary button to the surface, which keeps its edge at 3:1", () => {
    expect(under(buttonLook({ look: "secondary", host: "aria" }), "data-hovered:")).toStrictEqual(["bg-bg-surface"]);
  });

  it("fills a destructive button with its own solid red, which keeps white text legible in the dark theme", () => {
    const classes = buttonLook({ look: "danger", host: "aria" }).split(" ");
    expect(classes).toContain("bg-danger-solid");
    expect(under(classes.join(" "), "data-hovered:")).toStrictEqual(["bg-danger-solid-hover"]);
  });
});
