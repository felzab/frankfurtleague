import { readFileSync } from "node:fs";
import path from "node:path";

import postcss from "postcss";
import { describe, expect, it } from "vitest";

import { buttonLook } from "../src/kit/buttonStyles.ts";
import { PAIRS } from "./token-contrast.mjs";

/** The colour tokens, by the light theme's declarations in `tokens.css`. */
const COLOURS = (() => {
  const file = path.resolve(import.meta.dirname, "..", "src", "app", "tokens.css");
  const colours = new Set();
  postcss.parse(readFileSync(file, "utf8"), { from: file }).walkRules(":root", (rule) => {
    rule.walkDecls(/^--/, (decl) => {
      if (/^#[0-9a-f]{6}$/i.test(decl.value)) colours.add(decl.prop.slice(2));
    });
  });
  return colours;
})();

/** The colour token one utility paints under a state's prefix, the last one named winning. */
const painted = (classes, prefix, utility) =>
  classes
    .split(" ")
    .filter((name) => name.startsWith(`${prefix}${utility}-`) && COLOURS.has(name.slice(`${prefix}${utility}-`.length)))
    .map((name) => name.slice(`${prefix}${utility}-`.length))
    .at(-1);

/** Every state a button paints: at rest, React Aria's hover and press, and an anchor's `:hover` and `:active`. */
const STATES = ["", "data-hovered:", "data-pressed:", "hover:", "active:"];

const MEASURED = new Set(PAIRS.map(([ink, ground]) => `${ink} on ${ground}`));

/*
 * The rule measures the pairs it lists, not the button that wears them: a look moved onto another fill, as
 * the destructive button onto `--danger` (3.09:1 under white in the dark theme), would pass every check
 * while its label lost its contrast.
 */
describe("a button's label on its fill", () => {
  const cases = Object.keys(buttonLook.variants.look).flatMap((look) => ["aria", "link"].map((host) => ({ look, host })));

  it.each(cases)("is a measured pair for a $look button as $host, in every state", ({ look, host }) => {
    const classes = buttonLook({ look, host });
    const text = painted(classes, "", "text");
    expect(text, "this look names no colour for its label").toBeDefined();
    // A see-through fill stands on the page, which draws its surface or its raised one.
    const grounds = (fill) => (fill === undefined ? ["bg", "bg-surface"] : [fill]);

    const pairs = STATES.flatMap((state) =>
      grounds(painted(classes, state, "bg") ?? painted(classes, "", "bg")).map(
        (ground) => `${painted(classes, state, "text") ?? text} on ${ground}`,
      ),
    );
    expect(pairs.filter((pair) => !MEASURED.has(pair))).toStrictEqual([]);
  });
});
