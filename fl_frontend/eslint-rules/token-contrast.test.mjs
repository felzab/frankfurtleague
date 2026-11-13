import { readFileSync } from "node:fs";
import path from "node:path";

import css from "@eslint/css";
import { RuleTester } from "eslint";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

import { buttonLook } from "../src/kit/buttonStyles.ts";
import { Chip } from "../src/kit/Chip.tsx";
import tokenContrast, { PAIRS } from "./token-contrast.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const TOKENS_FILE = path.resolve(import.meta.dirname, "..", "src", "app", "tokens.css");
const TOKENS = readFileSync(TOKENS_FILE, "utf8");

/** The colour tokens, by the light theme's declarations in `tokens.css`. */
const COLOURS = (() => {
  const colours = new Set();
  postcss.parse(TOKENS, { from: TOKENS_FILE }).walkRules(":root", (rule) => {
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
    // A see-through fill stands on whatever holds it: the page, the rail, a card or an overlay.
    const grounds = (fill) => (fill === undefined ? ["bg", "bg-surface", "bg-card", "bg-overlay"] : [fill]);

    const pairs = STATES.flatMap((state) =>
      grounds(painted(classes, state, "bg") ?? painted(classes, "", "bg")).map(
        (ground) => `${painted(classes, state, "text") ?? text} on ${ground}`,
      ),
    );
    expect(pairs.filter((pair) => !MEASURED.has(pair))).toStrictEqual([]);
  });
});

/*
 * A chip on a see-through tint would stand on whatever holds it, a row under the pointer among them, which no pair
 * names: each tone's word and ground are one measured pair.
 */
describe("a chip's word on its ground", () => {
  // The tones `ChipProps` names.
  it.each(["success", "info", "warn", "danger", "neutral"])("is a measured pair for the %s chip", (tone) => {
    const classes = Chip({ tone, label: "Wort" }).props.className;
    expect(MEASURED.has(`${painted(classes, "", "text")} on ${painted(classes, "", "bg")}`)).toBe(true);
  });
});

/** `tokens.css` with one theme's declaration of `token` set to `value`. */
const withToken = (token, value, theme) => {
  const opener = theme === "dark" ? '[data-theme="dark"] {' : ":root {";
  const block = TOKENS.indexOf(opener);
  const at = TOKENS.indexOf(`--${token}:`, block);
  const end = TOKENS.indexOf(";", at);
  return `${TOKENS.slice(0, at)}--${token}: ${value}${TOKENS.slice(end)}`;
};

const tester = new RuleTester({ plugins: { css }, language: "css/css", languageOptions: { tolerant: true } });

const tooLow = (code) => ({ code, filename: "tokens.css", errors: [{ messageId: "tooLow" }] });

tester.run("tokens/contrast", tokenContrast, {
  valid: [{ code: TOKENS, filename: "tokens.css" }],
  invalid: [
    // A status chip's word on its tint, in either theme.
    tooLow(withToken("danger-tint", "#d0bdbe", "light")),
    tooLow(withToken("danger-tint", "#4a3a39", "dark")),
    // The neutral chip.
    tooLow(withToken("fg-muted-tint", "#bdbdbd", "light")),
    // A tint that lets the ground through cannot be measured.
    { code: withToken("warn-tint", "#85530020", "light"), filename: "tokens.css", errors: [{ messageId: "notHex" }] },
  ],
});
