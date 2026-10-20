import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { SCHIEDSRICHTER_OHNE_NAMEN_LABEL } from "@/features/schiedsrichter/constants.ts";
import { doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { declaredStatus } from "@/shared/testing/declaredStatus.ts";
import { assertLeer } from "@/shared/testing/leerGrade.ts";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas.ts";
import type { SpielFieldPath } from "@/features/spiele/draftStatus.ts";

doubleEveryAction();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { FormSchiedsrichterSection } = await import("./FormSchiedsrichterSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");
const { SpielExpectedProvider } = await import("./SpielExpectedContext.tsx");

const NO_DRAFT = declaredStatus<SpielFieldPath>(["schiedsrichter.schiedsrichter_id", "schiedsrichter.payment"]);

/** A referee who confirmed their own entry, which alone a fixture can be booked to. */
const BESTAETIGT: FLSchiedsrichter = {
  id: "6890a1b2c3d4e5f607800032",
  name: "Erika Muster",
  schule: null,
  default_payment: 25,
  kontakt: { telefon: null, email: "erika.muster@example.org" },
  inactive_since: null,
  geburtsdatum: "2007-03-01",
  einwilligung: {
    umfang: "kader_oeffentlich",
    datum: "2026-09-01",
    bestaetigt_am: "2026-09-01",
    text_version: "2026-10-schiedsrichterseite-4",
    medien: false,
    nachweis: { umfang: null, medien: null },
  },
  bestaetigung: null,
  adresswechsel: null,
};

/** One created and still waiting on its link, as the admin list serves it. */
const UNBESTAETIGT: FLSchiedsrichter = {
  ...BESTAETIGT,
  id: "6890a1b2c3d4e5f607800033",
  name: "Jonas Weber",
  kontakt: { telefon: null, email: "jonas.weber@example.org" },
  geburtsdatum: null,
  einwilligung: null,
};

/** A confirmed row the admin list serves nameless, as a hand-write leaves one. */
const NAMENLOS: FLSchiedsrichter = { ...BESTAETIGT, id: "6890a1b2c3d4e5f607800031", name: null };

/** The referee section alone, on a fixture with no referee booked. */
function renderPicker(schiedsrichter: FLSchiedsrichter[]): void {
  const picker = h(FormSchiedsrichterSection, {
    schiedsrichter,
    created: [],
    schiedsrichterPayload: null,
    onSchiedsrichterChange: () => {},
    onRequestCreate: () => {},
    onValidateFields: () => {},
  });
  render(h(DraftStatusProvider, { status: NO_DRAFT, children: h(SpielExpectedProvider, { expected: [], children: picker }) }));
}

/** The picker's own button, never the clear control a selection adds beside it. */
const trigger = (): HTMLElement =>
  screen.getAllByRole("button", { name: /Schiedsrichter/ }).find((button) => button.getAttribute("aria-haspopup") === "listbox") ??
  assert.fail("no referee picker");

/** The picker's row for one referee, by the name it lists. */
const option = (name: string): HTMLElement =>
  within(screen.getByRole("listbox"))
    .getAllByRole("option")
    .find((row) => row.textContent?.startsWith(name) === true) ?? assert.fail(`no row lists ${name}`);

describe("the referee picker's list", () => {
  /* A stand-in word stands where a name would, so its row takes the one empty grade the trigger takes. */
  it("sets a nameless row's stand-in word in the empty-value grade", async () => {
    const user = userEvent.setup();
    renderPicker([NAMENLOS]);

    await user.click(trigger());

    assertLeer(within(screen.getByRole("listbox")).getByText(SCHIEDSRICHTER_OHNE_NAMEN_LABEL), SCHIEDSRICHTER_OHNE_NAMEN_LABEL);
  });

  /* A fixture cannot be booked to an unconfirmed referee, and one left out of the list reads as never created. */
  it("lists an unconfirmed referee as not pickable, saying why, and a confirmed one as pickable", async () => {
    const user = userEvent.setup();
    renderPicker([BESTAETIGT, UNBESTAETIGT]);

    await user.click(trigger());

    assert.equal(option("Jonas Weber").getAttribute("aria-disabled"), "true");
    assert.ok(option("Jonas Weber").textContent?.includes("Noch nicht bestätigt"), "the row does not say why it cannot be picked");
    assert.notEqual(option("Erika Muster").getAttribute("aria-disabled"), "true");
  });

  /* Inside the field, so the picker names it in its own description rather than leaving it a stray line beside it. */
  it("describes the field by its hint", () => {
    renderPicker([BESTAETIGT]);

    const described = (trigger().getAttribute("aria-describedby") ?? "").split(" ");
    const texts = described.map((id) => document.getElementById(id)?.textContent ?? "");
    assert.ok(
      texts.some((text) => text.startsWith("Zur Auswahl steht, wer den eigenen Eintrag bestätigt hat.")),
      `the picker is described by ${JSON.stringify(texts)}`,
    );
  });
});
