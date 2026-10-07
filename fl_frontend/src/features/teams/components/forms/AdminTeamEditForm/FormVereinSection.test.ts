import { describe, it } from "node:test";

import { createElement as h } from "react";

import { declaredStatus } from "@/shared/testing/declaredStatus.ts";
import { assertLeerMarkup } from "@/shared/testing/leerGrade.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

import type { FLPostTeamPayload } from "@/features/teams/schemas.ts";
import type { TeamFieldPath } from "@/features/teams/teamDraftStatus.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { FormVereinSection } = await import("./FormVereinSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");

const NO_DRAFT = declaredStatus<TeamFieldPath>(["name", "shorthand", "full_name", "website_url", "description", "schulform"]);

const DRAFT: FLPostTeamPayload = {
  name: "Alpha",
  shorthand: "ALP",
  full_name: "Sportgemeinschaft Alpha",
  description: "",
  website_url: null,
  schulform: null,
  address: { strasse: "Feldweg", hausnummer: "3", plz: "60325", stadtteil: "", stadt: "Frankfurt" },
};

describe("the club editor's description preview", () => {
  /* A team's description is a stored field, so an empty one reads as every empty field does, in the
     empty-value grade, even inside the button that edits it. */
  it("reads an empty description as „Nicht hinterlegt“ in the empty-value grade", () => {
    const section = h(FormVereinSection, { draft: DRAFT, onChange: () => {}, onFieldLeft: () => {}, onValidateSelection: () => {} });

    assertLeerMarkup(renderTree(h(DraftStatusProvider, { status: NO_DRAFT, children: section })), "Nicht hinterlegt");
  });
});
