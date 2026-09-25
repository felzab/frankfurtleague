import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { renderToStaticMarkup } from "react-dom/server";
import z from "zod";

import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";

import { renderTree } from "@/shared/testing/renderTest.ts";
import { compiledGlobals } from "@/shared/testing/stylesheet.ts";

import type { FLAddress } from "@/shared/schemas.ts";
import type { ComponentProps, ReactNode } from "react";

const { AddressFields } = await import("./AddressFields.tsx");
const { Form } = await import("./Form.tsx");
const { requiredBy } = await import("./RequiredMarks.tsx");
const { TextField } = await import("./TextField.tsx");

const NO_ADDRESS: FLAddress = { strasse: "", hausnummer: "", plz: "", stadtteil: "", stadt: "" };

/** The street refuses an empty box and the district takes one, so one field is required and the other not. */
const STRASSE_REQUIRED = z.object({ strasse: z.string().nonempty(), stadtteil: z.string() });

/**
 * What `EntityForm` puts on a form that marks its required fields. Asserted rather than written inline
 * because TypeScript waves a hyphenated attribute through in JSX position only, and this file has none.
 */
const MARKS_REQUIRED = { "data-required-marks": "on", onSubmit: () => undefined, schemas: [STRASSE_REQUIRED] } as ComponentProps<typeof Form>;

/** A required text field, with its label wrapped in as many elements as the caller nests it. */
function renderField({ wrappers, marksRequired }: { wrappers: number; marksRequired?: boolean }): string {
  let label: ReactNode = h(Label, null, "Straße");
  for (let depth = 0; depth < wrappers; depth++) label = h("div", null, label);

  return renderToStaticMarkup(
    h(
      Form,
      // The app's own form rather than HeroUI's, so the mode the case below pins is the one it sets.
      marksRequired ? MARKS_REQUIRED : { onSubmit: () => undefined, schemas: [STRASSE_REQUIRED] },
      h(TextField, { name: "strasse" }, label, h(Input, null), h(FieldError, null)),
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

describe("where a field's required mark comes from", () => {
  /** The district's box as the address editor renders it, under a form submitting `stadtteil` as given. */
  const districtBox = (stadtteil: z.ZodType): string => {
    const html = renderTree(
      h(
        Form,
        { onSubmit: () => undefined, schemas: [z.object({ address: z.object({ stadtteil }) })] },
        h(AddressFields, { value: NO_ADDRESS, onChange: () => undefined }),
      ),
    );

    return /<input\b[^>]*\bname="address\.stadtteil"[^>]*>/.exec(html)?.[0] ?? assert.fail("the address editor renders no district box");
  };

  // Every admin address takes an empty district; the application's payload refuses one.
  it("marks the district exactly where the schema its form submits refuses it empty", () => {
    assert.doesNotMatch(districtBox(z.string()), /\baria-required="true"/, "the district is required where its schema takes an empty one");
    assert.match(districtBox(z.string().nonempty()), /\baria-required="true"/, "a schema refusing the empty district leaves it unmarked");
  });

  it("leaves a field optional where its schema takes null", () => {
    assert.doesNotMatch(districtBox(z.string().nonempty().nullable()), /\baria-required="true"/, "a leaf taking null is marked");
  });

  it("reaches a leaf through a section the payload may leave out", () => {
    const schule = z.object({ schule: z.object({ full_name: z.string().nonempty() }).nullable().optional() });

    assert.equal(requiredBy([schule], "schule.full_name", ""), true);
  });

  it("marks no path the schemas do not carry, and a path any one of them refuses", () => {
    const withName = z.object({ name: z.string().nonempty() });

    assert.equal(requiredBy([withName], "kuerzel", ""), false, "a path outside every schema is marked");
    assert.equal(requiredBy([z.object({}), withName], "name", ""), true, "the second schema's refusal goes unread");
  });

  it("judges the emptiness the field's own control writes", () => {
    const einwilligung = z.object({ erteilt: z.literal(true), whatsapp: z.boolean() });

    assert.equal(requiredBy([einwilligung], "erteilt", false), true, "a switch the schema needs on is unmarked");
    assert.equal(requiredBy([einwilligung], "whatsapp", false), false, "a switch the schema takes off is marked");
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
