import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { renderToStaticMarkup } from "react-dom/server";

import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { TextField } from "@heroui/react/textfield";

import { renderTree } from "@/shared/testing/renderTest.ts";
import { compiledGlobals } from "@/shared/testing/stylesheet.ts";

import type { FLAddress } from "@/shared/schemas.ts";
import type { ComponentProps, ReactNode } from "react";

const { AddressFields } = await import("./AddressFields.tsx");
const { Form } = await import("./Form.tsx");

const NO_ADDRESS: FLAddress = { strasse: "", hausnummer: "", plz: "", stadtteil: "", stadt: "" };

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
      // The app's own form rather than HeroUI's, so the mode the case below pins is the one it sets.
      (marksRequired ? MARKS_REQUIRED : {}) as ComponentProps<typeof Form>,
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
  /** The district's box as the address editor renders it under the app's own mode. */
  const districtBox = (isStadtteilRequired?: boolean): string => {
    const html = renderTree(
      h(
        Form,
        null,
        h(AddressFields, {
          value: NO_ADDRESS,
          onChange: () => undefined,
          ...(isStadtteilRequired === undefined ? {} : { isStadtteilRequired }),
        }),
      ),
    );

    return /<input\b[^>]*\bname="address\.stadtteil"[^>]*>/.exec(html)?.[0] ?? assert.fail("the address editor renders no district box");
  };

  // The default keeps every admin address optional; the application form is the one caller opting in.
  it("hands the district's required-ness to the caller, defaulting off", () => {
    assert.doesNotMatch(districtBox(), /\baria-required="true"/, "the district is required where no caller asked for it");
    assert.match(districtBox(true), /\baria-required="true"/, "the caller's opt-in never reaches the district's box");
  });
});

describe("the stylesheet rules that decide whether the asterisk is drawn and what colour it takes", () => {
  const compiled = compiledGlobals();

  /** Both rules must key off this exact relationship, or the opt-out stops reaching what HeroUI draws. */
  const SHARED_SHAPE = /\[data-required="true"\][^,{]*>\s*\.label/;

  it("still finds HeroUI drawing the asterisk from a direct-child label", async () => {
    const root = await compiled;
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
    const root = await compiled;
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

  it("still finds the opt-in drawing the mark muted, from outside the layer that draws it danger", async () => {
    const root = await compiled;
    const override: { selector: string; unlayered: boolean; muted: boolean }[] = [];

    root.walkRules((rule) => {
      if (!rule.selector.includes('form[data-required-marks="on"]')) return;
      const muted = rule.some((node) => node.type === "decl" && node.prop === "color" && node.value === "var(--fg-muted)");
      override.push({ selector: rule.selector, unlayered: rule.parent?.type === "root", muted });
    });

    assert.equal(override.length, 1, `expected exactly one colour override; got ${JSON.stringify(override)}`);
    assert.ok(SHARED_SHAPE.test(override[0]!.selector), `the override no longer matches what HeroUI draws: ${override[0]!.selector}`);
    // Red is what a refused field looks like, so the mark taking any other grade is the regression.
    assert.ok(override[0]!.muted, "the required mark is drawn in something other than the muted grade");
    // HeroUI's selector is the more specific of the two, so nothing but layer order carries this rule.
    assert.ok(override[0]!.unlayered, "the colour override has fallen into a cascade layer and can no longer win");
  });
});
