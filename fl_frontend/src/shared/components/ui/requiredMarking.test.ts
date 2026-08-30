import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import { renderToStaticMarkup } from "react-dom/server";

import { FieldError, Form, Input, Label, TextField } from "@heroui/react";

import type { ComponentProps, ReactNode } from "react";

/**
 * What `EntityForm` puts on a form that marks its required fields. Asserted rather than written inline
 * because TypeScript waves a hyphenated attribute through in JSX position only, and this file has none.
 */
const MARKS_REQUIRED = { "data-required-marks": "on" } as ComponentProps<typeof Form>;

/** A required text field, with its label wrapped in as many elements as the caller nests it. */
function renderField({ wrappers, marksRequired }: { wrappers: number; marksRequired?: boolean }): string {
  let label: ReactNode = h(Label, null, "Straße");
  for (let depth = 0; depth < wrappers; depth++) label = h("div", null, label);

  return renderToStaticMarkup(
    h(
      Form,
      // The app's own mode. In `native` these fields would carry a real `required`, which is what
      // paints the browser's message the moment an edited field is cleared.
      { validationBehavior: "aria", ...(marksRequired ? MARKS_REQUIRED : {}) } as ComponentProps<typeof Form>,
      h(TextField, { isRequired: true, name: "strasse" }, label, h(Input, null), h(FieldError, null)),
      h(TextField, { name: "stadtteil" }, h(Label, null, "Stadtteil"), h(Input, null), h(FieldError, null)),
    ),
  );
}

/**
 * The tag opening immediately after the element carrying `data-required="true"` — the one position HeroUI's `> .label`
 * can match. Scanning the string is enough, the labels rendered here carrying no `>` of their own.
 */
function firstChildTag(html: string): string {
  const rootTagEnd = html.indexOf(">", html.indexOf('data-required="true"'));
  return html.slice(rootTagEnd + 1, html.indexOf(">", rootTagEnd + 1) + 1);
}

/** HeroUI renders the label as a `<span class="label">` wherever a `<label>` may not wrap the control. */
const isLabelTag = (tag: string): boolean => /^<(label|span)[^>]*\bclass="label\b/.test(tag);

describe("where a field puts its label", () => {
  it("leaves it in the asterisk rule's reach when it is a direct child", () => {
    const tag = firstChildTag(renderField({ wrappers: 0, marksRequired: true }));

    assert.ok(isLabelTag(tag), `expected the label as the first child; got ${tag}`);
  });

  it("puts it out of reach once anything wraps it", () => {
    const tag = firstChildTag(renderField({ wrappers: 1 }));

    assert.ok(!isLabelTag(tag), `expected a wrapper as the first child; got ${tag}`);
  });

  it("carries the form's opt-in only where the caller asked for marks", () => {
    assert.match(renderField({ wrappers: 0, marksRequired: true }), /<form[^>]*data-required-marks="on"/);
    assert.doesNotMatch(renderField({ wrappers: 0 }), /data-required-marks/);
  });
});

describe("what a required field asks of the browser", () => {
  for (const wrappers of [0, 1, 2]) {
    it(`declares itself required to assistive technology with the label ${wrappers} wrappers deep`, () => {
      const inputs = renderField({ wrappers }).match(/<input\b[^>]*>/g) ?? [];
      const declared = inputs.filter((input) => /\baria-required="true"/.test(input));

      assert.equal(declared.length, 1);
      // The optional field is the control: a mark on both would satisfy the count above on its own.
      assert.equal(inputs.length, 2);
    });
  }

  it("asks the browser for nothing, which is what keeps a cleared field quiet", () => {
    // `aria` drops the native attribute and keeps the ARIA one. Were `required` to come back, react-aria
    // would commit `valueMissing` on every DOM `change` and paint the browser's message on a blur.
    const inputs = renderField({ wrappers: 0 }).match(/<input\b[^>]*>/g) ?? [];

    assert.ok(!inputs.some((input) => /\brequired=""/.test(input)), `a native required survived: ${inputs.join(" ")}`);
  });
});

describe("what an opt-in required prop actually reaches", () => {
  it("hands the district's required-ness to the caller, defaulting off", async () => {
    // The component cannot be imported here — the runner reads no `.tsx` — so this grades the wiring while the
    // case above grades the mechanism it depends on. The default keeps every admin address optional.
    const source = await readFile(path.join(import.meta.dirname, "AddressFields.tsx"), "utf8");

    assert.match(source, /isStadtteilRequired = false,/);
    assert.match(source, /isRequired=\{isStadtteilRequired\}\s*\n\s*name=\{`\$\{namePrefix\}\.stadtteil`\}/);
  });
});

describe("the two stylesheet rules that decide whether the asterisk is drawn", () => {
  const compiled = (async () => {
    const from = path.join(import.meta.dirname, "..", "..", "..", "app", "globals.css");
    return postcss([tailwind()]).process(await readFile(from, "utf8"), { from });
  })();

  /** Both rules must key off this exact relationship, or the opt-out stops reaching what HeroUI draws. */
  const SHARED_SHAPE = /\[data-required="true"\][^,{]*>\s*\.label/;

  it("still finds HeroUI drawing the asterisk from a direct-child label", async () => {
    const { root } = await compiled;
    const drawing: string[] = [];

    root.walkRules((rule) => {
      if (!SHARED_SHAPE.test(rule.selector)) return;
      if (rule.some((node) => node.type === "decl" && node.prop === "--tw-content" && node.value === "'*'")) {
        drawing.push(rule.selector);
      }
    });

    assert.equal(drawing.length, 1, `expected exactly one asterisk rule; got ${JSON.stringify(drawing)}`);
  });

  it("still finds the opt-out able to reach it, and outranking its layer", async () => {
    const { root } = await compiled;
    const optOut: { selector: string; unlayered: boolean }[] = [];

    root.walkRules((rule) => {
      if (!rule.selector.includes('form:not([data-required-marks="on"])')) return;
      optOut.push({ selector: rule.selector, unlayered: rule.parent?.type === "root" });
    });

    assert.equal(optOut.length, 1, `expected exactly one opt-out rule; got ${JSON.stringify(optOut)}`);
    assert.ok(SHARED_SHAPE.test(optOut[0]!.selector), `the opt-out no longer matches what HeroUI draws: ${optOut[0]!.selector}`);
    // Layer order beats specificity, and HeroUI declares the asterisk in `@layer components`.
    assert.ok(optOut[0]!.unlayered, "the opt-out has fallen into a cascade layer and can no longer win");
  });
});
