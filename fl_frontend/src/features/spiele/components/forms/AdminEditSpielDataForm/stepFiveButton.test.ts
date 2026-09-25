import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { cleanup, render } from "@testing-library/react";

import { doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { declaredStatus } from "@/shared/testing/declaredStatus.ts";
import { compiledGlobals, selectorsOf } from "@/shared/testing/stylesheet.ts";

import type { SpielFieldPath } from "@/features/spiele/draftStatus.ts";
import type { Rule } from "postcss";
import type { ReactNode } from "react";

doubleEveryAction();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { FormSpielortSection } = await import("./FormSpielortSection.tsx");
const { FormSchiedsrichterSection } = await import("./FormSchiedsrichterSection.tsx");
const { SpielExpectedProvider } = await import("./SpielExpectedContext.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");
const { NumberField } = await import("@/shared/components/ui/NumberField.tsx");
const { Label } = await import("@heroui/react/label");

const STATUS = declaredStatus<SpielFieldPath>([
  "ort.spielort_id",
  "ort.mietpreis",
  "schiedsrichter.schiedsrichter_id",
  "schiedsrichter.payment",
]);

/** Every compiled `grid-template-columns` HeroUI's number-field sheet writes, by the selectors it applies under. */
const columns = (async () => {
  const found: { selectors: string[]; value: string }[] = [];
  (await compiledGlobals()).walkDecls("grid-template-columns", (decl) => {
    if (decl.parent?.type !== "rule") return;
    const selectors = selectorsOf(decl.parent as Rule).filter((selector) => selector.includes(".number-field__group"));
    if (selectors.length > 0) found.push({ selectors, value: decl.value.replace(/\s+/g, " ") });
  });

  return found;
})();

/**
 * The column templates the stylesheet offers a group: which one wins is a browser's to say, so a group is
 * compared by the whole set it matches, never by a winner picked here.
 */
async function groupOf(tree: ReactNode): Promise<{ children: Element[]; templates: string[] }> {
  render(tree);
  const group = document.body.querySelector('[data-slot="number-field-group"]') ?? assert.fail("no number field group rendered");
  const templates = (await columns).filter((rule) => rule.selectors.some((selector) => group.matches(selector))).map((rule) => rule.value);
  const children = Array.from(group.children);
  cleanup();

  return { children, templates: templates.sort() };
}

const underProviders = (section: ReactNode) =>
  h(DraftStatusProvider, { status: STATUS, children: h(SpielExpectedProvider, { expected: [], children: section }) });

const SECTIONS: [string, ReactNode][] = [
  [
    "Mietpreis",
    underProviders(
      h(FormSpielortSection, {
        spielorte: [],
        ortPayload: { spielort_id: "6890a1b2c3d4e5f607800021", name: "Turnhalle Riedberg", maps_link: "Riedberg", mietpreis: 40 },
        onOrtChange: () => {},
        onValidateFields: () => {},
      }),
    ),
  ],
  [
    "Honorar",
    underProviders(
      h(FormSchiedsrichterSection, {
        schiedsrichter: [],
        schiedsrichterPayload: { schiedsrichter_id: "6890a1b2c3d4e5f607800022", name: "Pierluigi Collina", payment: 20 },
        onSchiedsrichterChange: () => {},
        onValidateFields: () => {},
      }),
    ),
  ],
];

/** HeroUI's own three-part group, whose steppers HeroUI renders: the layout the hand-built ones must match. */
const HEROUI_GROUP = h(
  NumberField,
  { value: 1, onChange: () => {} },
  h(Label, null, "Tore"),
  h(NumberField.Group, null, h(NumberField.DecrementButton), h(NumberField.Input), h(NumberField.IncrementButton)),
);

describe("the match editor's five-step number fields against HeroUI's grid", () => {
  for (const [label, tree] of SECTIONS) {
    /* HeroUI sizes the group's columns from the steppers it finds in it; a stepper it does not recognise leaves one
       column, and the three children stack into a group one row high. */
    it(`lays out ${label}'s three children in the columns HeroUI's own group takes`, async () => {
      const reference = await groupOf(HEROUI_GROUP);
      assert.ok(reference.templates.includes("40px 1fr 40px"), "HeroUI's own group takes no three-column template: re-read `number-field.css`");

      const { children, templates } = await groupOf(tree);
      assert.deepEqual(
        children.map((child) => child.tagName.toLowerCase()),
        ["button", "input", "button"],
        `${label}'s group holds other than a stepper, its box and a stepper`,
      );
      assert.deepEqual(templates, reference.templates, `${label}'s group is not sized as HeroUI's own three-part group`);
    });
  }
});
