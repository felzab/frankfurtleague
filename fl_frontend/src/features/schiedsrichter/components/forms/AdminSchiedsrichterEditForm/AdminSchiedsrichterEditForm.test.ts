import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { SCHIEDSRICHTER_EINLADEN_OHNE_ADRESSE } from "@/features/schiedsrichter/constants.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { closedControl } from "@/shared/testing/closedControl.ts";
import { nextRouter, underNext } from "@/shared/testing/nextContexts.ts";

/* Every write hangs until a case answers it: a real action needs a session and a backend. */
const { calls, answerWith } = doubleActions({
  modules: ["/src/features/schiedsrichter/actions.ts"],
  answer: () => new Promise<never>(() => undefined),
});

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdminSchiedsrichterEditForm } = await import("./AdminSchiedsrichterEditForm.tsx");

const PLATZHALTER = "adresse-fehlt@frankfurtleague.invalid";

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

afterEach(() => {
  calls.length = 0;
  toasts.length = 0;
});

/* The panel is handed the STORED address's standing, never the draft's, and the placeholder a row without one is
   given is nowhere a link can go. */
describe("the confirmation panel inside the referee's editor", () => {
  it("closes the send on a row holding only the placeholder address, naming what to repair", () => {
    render(editor(PLATZHALTER));

    closedControl("Bestätigungslink senden", SCHIEDSRICHTER_EINLADEN_OHNE_ADRESSE);
  });

  // Without it an editor closing the send on every row passes the case above.
  it("offers the send on a row holding an address", () => {
    render(editor("anna.koerner@schule.de"));

    const send = screen.getByRole("button", { name: "Bestätigungslink senden" });
    assert.notEqual(send.getAttribute("aria-disabled"), "true", "the send is closed on a row holding an address");
  });
});

/* The undo replays the STORED record, and a placeholder written back is an address the payload refuses: the offer
   names that before any round trip rather than dispatching a restore the route can only turn away. */
describe("the undo a referee's save offers", () => {
  async function saveAddressOver(stored: string): Promise<void> {
    const user = userEvent.setup({ delay: null });
    answerWith(() => Promise.resolve({ success: true, message: "Gespeichert." }));
    render(editor(stored));
    const box = screen.getByRole<HTMLInputElement>("textbox", { name: "E-Mail" });

    await user.clear(box);
    await user.type(box, "anna.koerner@schule.de");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    // The write runs inside a transition, so its answer and the offer behind it land after the press.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(calls.length, 1, "the press never reached the write, so the undo below proves nothing");
  }

  const pressUndo = (): void => {
    const offer = toasts.find((toast) => toast.title === "Änderung gespeichert") ?? assert.fail("the save offered no undo");
    const press = (offer.options as { actionProps?: { onPress?: () => void } } | undefined)?.actionProps?.onPress;
    (press ?? assert.fail("the offer carries no undo control"))();
  };

  it("refuses to write the placeholder back, naming the address it lacked", async () => {
    await saveAddressOver(PLATZHALTER);
    pressUndo();

    const refusal = toasts.at(-1);
    assert.equal(refusal?.title, "Änderung nicht zurückgenommen", "the undo was dispatched rather than refused");
    assert.match(String(refusal?.description), /keine echte E-Mail-Adresse hinterlegt/);
  });

  // Without it an offer refusing every undo passes the case above.
  it("dispatches the undo over a row whose address was a real one", async () => {
    await saveAddressOver("anna.alt@schule.de");
    pressUndo();

    // Read at the press itself: the dispatch raises its pending toast before any round trip.
    assert.equal(toasts.at(-1)?.title, "Nimmt Änderung zurück...", "an undo with an address to restore was not dispatched");
  });
});
