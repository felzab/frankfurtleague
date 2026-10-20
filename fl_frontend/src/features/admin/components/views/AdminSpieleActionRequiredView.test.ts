import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";

import { underNext } from "@/shared/testing/nextContexts.ts";

import type { FLSpielbestaetigung } from "@/features/spielbestaetigungen/schemas.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdminSpieleActionRequiredView } = await import("./AdminSpieleActionRequiredView.tsx");

const renderView = (bestaetigungen: readonly FLSpielbestaetigung[] | null, bestaetigungenVollstaendig = true): void => {
  render(
    underNext(
      h(AdminSpieleActionRequiredView, {
        overviewSpiele: [],
        bracketFaults: [],
        bestaetigungen,
        bestaetigungenVollstaendig,
        today: "2026-07-30",
        isFinishedSaison: false,
      }),
      { search: "saison_id=2026" },
    ),
  );
};

// Each tab reading zero would say a category is clear, so a failed or cut read is said above them.
describe("the triage's notice about the confirmation rows", () => {
  it("says the rows could not be read, rather than showing their tabs as clear", () => {
    renderView(null);

    screen.getByText("Die Spielbestätigungen ließen sich gerade nicht lesen");
  });

  it("says the rows were cut, and which category the cut can leave short", () => {
    renderView([], false);

    screen.getByText("Die Spielbestätigungen sind unvollständig");
    screen.getByText(/von den geschlossenen nur die neuesten\. „Schiedsrichter hat abgelehnt“ kann deshalb Spiele auslassen\./);
  });

  it("says nothing of a whole read", () => {
    renderView([]);

    assert.equal(screen.queryAllByText(/^Die Spielbestätigungen/).length, 0, "a whole read raised the notice");
  });
});
