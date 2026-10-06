import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, within } from "@testing-library/react";

import { underNext } from "@/shared/testing/nextContexts.ts";

import type { FLSchiedsrichterSelbst } from "../../schemas.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SchiedsrichterSelbstView } = await import("./SchiedsrichterSelbstView.tsx");

const SCHIEDSRICHTERIN: FLSchiedsrichterSelbst = {
  schiedsrichter_id: "6890a1b2c3d4e5f607390041",
  name: "Mara Okafor",
  schule: "Lessing-Gymnasium",
  kontakt: { telefon: "069 1234567", email: "mara@example.org" },
  honorar: 25,
  geburtsdatum: "2007-03-01",
  inactive_since: null,
  einwilligung: {
    umfang: "intern",
    erteilt_von: "volljaehrig",
    datum: "2026-09-01",
    bestaetigt_am: "2026-09-01",
    text_version: "2026-09-schiedsrichterseite-3",
    medien: false,
    nachweis: { umfang: null, medien: null },
  },
  bestaetigt_text_version: "2026-09-schiedsrichterseite-3",
  nachweis_stand: { umfang: null, medien: null },
  kontext: { vorname: "Mara" },
  erteilbar: true,
  medien_angeboten: true,
};

const renderView = (schiedsrichter: readonly FLSchiedsrichterSelbst[] = [SCHIEDSRICHTERIN]) =>
  render(underNext(h(SchiedsrichterSelbstView, { schiedsrichter })));

describe("a referee's own page", () => {
  /* The person tier's read, read by the person it names: the whole name and their own contact details. */
  /* The fee among them: the referee's confirmation page lists it as stored, so the page shows it. */
  it("shows the whole name, the school, the contact details, the birthdate and the fee under one panel heading", () => {
    renderView();

    assert.equal(screen.getAllByRole("heading", { level: 2, name: "Deine Angaben" }).length, 1);
    // The fee with a plain space: the matcher folds the node's whitespace, the formatter's no-break space among it, and never its own.
    for (const wert of ["Mara Okafor", "Lessing-Gymnasium", "mara@example.org", "069 1234567", "01.03.2007", "25,00 €"]) {
      assert.ok(screen.getByText(wert), `the page does not show „${wert}“`);
    }
  });

  /* A row with no address of its own holds a placeholder, which is no address the person could use. */
  it("names an absent address, school and telephone as not recorded, never the placeholder", () => {
    renderView([{ ...SCHIEDSRICHTERIN, schule: null, kontakt: { telefon: null, email: "ohne-adresse@example.invalid" } }]);

    assert.equal(screen.getAllByText("Nicht hinterlegt").length, 3);
    assert.equal(screen.queryAllByText(/\.invalid/).length, 0, "the page shows the placeholder address");
  });

  /* One address may hold several referee rows; each is its own panel. */
  it("shows one panel per referee row the address holds", () => {
    renderView([SCHIEDSRICHTERIN, { ...SCHIEDSRICHTERIN, schiedsrichter_id: "6890a1b2c3d4e5f607390042", name: "Mara O." }]);

    assert.equal(screen.getAllByRole("heading", { level: 2, name: "Deine Angaben" }).length, 2);
  });

  /* The referee's control lives on the account page, so this page offers none and sends the reader there. */
  it("offers no consent control and links the account page", () => {
    const { container } = renderView();

    assert.equal(screen.queryAllByRole("switch").length + screen.queryAllByRole("radiogroup").length, 0);
    assert.equal(within(container).getByRole("link", { name: "Konto" }).getAttribute("href"), "/bereich/konto");
  });

  /* The control it points to moves the schedule listing and the media consent both, so the pointer names both. */
  it("points to the account page for both choices", () => {
    const { container } = renderView();

    const pointer = within(container).getByRole("link", { name: "Konto" }).closest("p")?.textContent ?? "";
    assert.ok(pointer.includes("im Spielplan") && pointer.includes("auf der Website"), pointer);
  });
});
