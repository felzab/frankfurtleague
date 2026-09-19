import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";

import { Label } from "@heroui/react";

import type { ReactNode } from "react";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SaisonCountSelect, SaisonTiebreakSelect } = await import("@/features/saisons/components/forms/SaisonFormControls.tsx");
const { TrikotFarbeSelect } = await import("@/features/teams/components/forms/TrikotFarbeSelect.tsx");

const ignore = () => undefined;

/** Each picker as its callers render it, and the one name its trigger owes. */
const FIELDS: [name: string, field: ReactNode][] = [
  [
    "Gruppen",
    h(SaisonCountSelect, {
      name: "rules.number_of_groups",
      label: h(Label, null, "Gruppen"),
      ariaLabel: "Gruppen",
      value: 2,
      options: [],
      onChange: ignore,
    }),
  ],
  [
    "Was zuerst entscheidet",
    h(SaisonTiebreakSelect, {
      name: "rules.tiebreak_order",
      label: h(Label, null, "Was zuerst entscheidet"),
      value: "tordifferenz",
      onChange: ignore,
    }),
  ],
  ["Trikotfarbe", h(TrikotFarbeSelect, { value: null, onChange: ignore })],
  // The club editor's arm, whose marker-carrying label stands outside the picker.
  ["Trikotfarbe", h(TrikotFarbeSelect, { value: null, onChange: ignore, withOwnLabel: false })],
];

describe("a picker's accessible name", () => {
  /* Beside the picker's own visible label a second name reads the field out twice, „Gruppen Gruppen“; a picker
     without that label still needs the one name a screen reader and speech input find it by (WCAG 2.5.3). */
  it("is the words on its label, once", () => {
    for (const [name, field] of FIELDS) {
      const { unmount } = render(field);

      screen.getByRole("button", { name });
      unmount();
    }
  });
});
