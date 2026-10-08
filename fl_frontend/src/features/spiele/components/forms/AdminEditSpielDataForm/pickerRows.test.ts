import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

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

/** A row the admin list serves nameless, as a hand-write leaves one. */
const NAMENLOS: FLSchiedsrichter = {
  id: "6890a1b2c3d4e5f607800031",
  name: null,
  schule: null,
  default_payment: 25,
  kontakt: { telefon: null, email: null },
  inactive_since: null,
  geburtsdatum: null,
  einwilligung: null,
  bestaetigung: null,
  adresswechsel: null,
};

describe("the referee picker's list", () => {
  /* A stand-in word stands where a name would, so its row takes the one empty grade the trigger takes. */
  it("sets a nameless row's stand-in word in the empty-value grade", async () => {
    const user = userEvent.setup();
    const picker = h(FormSchiedsrichterSection, {
      schiedsrichter: [NAMENLOS],
      schiedsrichterPayload: null,
      onSchiedsrichterChange: () => {},
      onValidateFields: () => {},
    });
    render(h(DraftStatusProvider, { status: NO_DRAFT, children: h(SpielExpectedProvider, { expected: [], children: picker }) }));

    await user.click(screen.getByRole("button", { name: /Schiedsrichter/ }));

    assertLeer(within(screen.getByRole("listbox")).getByText(SCHIEDSRICHTER_OHNE_NAMEN_LABEL), SCHIEDSRICHTER_OHNE_NAMEN_LABEL);
  });
});
