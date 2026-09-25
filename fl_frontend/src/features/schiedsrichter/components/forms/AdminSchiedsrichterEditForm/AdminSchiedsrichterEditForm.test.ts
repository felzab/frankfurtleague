import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";

import { SCHIEDSRICHTER_EINLADEN_OHNE_ADRESSE } from "@/features/schiedsrichter/constants.ts";
import { doubleActions } from "@/shared/testing/actionDoubles.ts";
import { closedControl } from "@/shared/testing/closedControl.ts";
import { nextRouter, underNext } from "@/shared/testing/nextContexts.ts";

/* Every write hangs: no case here presses anything, and a real action needs a session and a backend. */
doubleActions({
  modules: ["/src/features/schiedsrichter/actions.ts"],
  answer: () => new Promise<never>(() => undefined),
});

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdminSchiedsrichterEditForm } = await import("./AdminSchiedsrichterEditForm.tsx");

const RECORD = {
  id: "6890a1b2c3d4e5f607800001",
  name: "Anna Körner",
  schule: null,
  default_payment: 20,
  geburtsdatum: null,
  einwilligung: null,
  bestaetigung: null,
};

const editor = (email: string | null) =>
  underNext(
    h(AdminSchiedsrichterEditForm, {
      schiedsrichter: { ...RECORD, kontakt: { telefon: null, email } },
      isRetired: false,
      pageHeader: { title: RECORD.name },
    }),
    { router: nextRouter(), search: "saison_id=2526" },
  );

/* The panel is handed the STORED address's standing, never the draft's, and the placeholder a row without one is
   given is nowhere a link can go. */
describe("the confirmation panel inside the referee's editor", () => {
  it("closes the send on a row holding only the placeholder address, naming what to repair", () => {
    render(editor("adresse-fehlt@frankfurtleague.invalid"));

    closedControl("Bestätigungslink senden", SCHIEDSRICHTER_EINLADEN_OHNE_ADRESSE);
  });

  // Without it an editor closing the send on every row passes the case above.
  it("offers the send on a row holding an address", () => {
    render(editor("anna.koerner@schule.de"));

    const send = screen.getByRole("button", { name: "Bestätigungslink senden" });
    assert.notEqual(send.getAttribute("aria-disabled"), "true", "the send is closed on a row holding an address");
  });
});
