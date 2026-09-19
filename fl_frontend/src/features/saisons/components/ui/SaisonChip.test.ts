import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { renderTree } from "@/shared/testing/renderTest.ts";

import { laufendDot } from "./laufendDot.ts";

/* Reached with `await import` and never a static import beside the harness
   (`docs/frontend/spec.md` §1.9). */
const { SaisonChip } = await import("./SaisonChip.tsx");

const DOT = `class="${laufendDot("xs")}"`;

describe("the chip heading a season's public page", () => {
  /* The dot says „laufend“, so on a past or planned season's application page it tells a school the
     season it is applying for has already started. */
  it("wears the running dot for a running season and for no other", () => {
    assert.ok(renderTree(h(SaisonChip, { isLaufend: true, children: "Saison 2526" })).includes(DOT), "a running season's chip lost its dot");
    assert.ok(
      !renderTree(h(SaisonChip, { isLaufend: false, children: "Saison 2627" })).includes(DOT),
      "a season not known to be running wears the running dot",
    );
  });
});
