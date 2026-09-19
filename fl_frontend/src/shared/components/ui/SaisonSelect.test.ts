import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SaisonSelect } = await import("./SaisonSelect.tsx");

describe("the season a create form writes", () => {
  /* react-aria names the trigger by its label, so an `aria-label` beside the visible one is read out as a second „Saison“. */
  it("is named once, by its visible label", () => {
    render(h(SaisonSelect, { value: "2026", onChange: () => undefined, saisonIds: ["2026", "2027"] }));

    assert.ok(screen.getByRole("button", { name: "Saison" }), "the picker is named other than by its label alone");
  });
});
