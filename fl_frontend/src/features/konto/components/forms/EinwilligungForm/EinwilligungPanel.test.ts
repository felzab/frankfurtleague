import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { PersonUmfang } from "./EinwilligungForm.tsx";
import type { EinwilligungEintrag } from "./EinwilligungPanel.tsx";

doubleToasts();

const { EinwilligungPanel } = await import("./EinwilligungPanel.tsx");
const { EinwilligungForm } = await import("./EinwilligungForm.tsx");

/** Pressed by no case: the panel's own suite reads what it lays out, and the control's presses are its own suite's. */
const speichereAction = () => Promise.resolve({ success: true as const, nachweis_stand: { umfang: null, medien: null } });

const eintrag = (
  id: string,
  titel: string,
  bestaetigt: EinwilligungEintrag["bestaetigt"],
  angaben?: EinwilligungEintrag["angaben"],
): EinwilligungEintrag => ({
  id: id,
  titel: titel,
  ...(angaben === undefined ? {} : { angaben: angaben }),
  bestaetigt: bestaetigt,
  control: h(EinwilligungForm<PersonUmfang>, {
    worte: {
      textVersion: "konto-test-1",
      medien: { schalter: `Fotos von mir (${titel})`, absatz: "Fotos kannst Du hier zurücknehmen." },
      widerruf: "Jede Änderung gilt ab dem Speichern.",
    },
    gespeichert: { umfang: "intern", medien: false },
    nachweisStand: { umfang: null, medien: null },
    medienAngeboten: true,
    erteilbar: true,
    speichereAction: speichereAction,
  }),
});

const renderPanel = (eintraege: readonly EinwilligungEintrag[]) => render(underNext(h(EinwilligungPanel, { eintraege })));

describe("the account page's consent section", () => {
  /* The account page is every signed-in person's, and most of them hold no consent: an empty section
     would be a heading over nothing. */
  it("renders nothing for a person holding no consent record", () => {
    const { container } = renderPanel([]);

    assert.equal(container.innerHTML, "");
  });

  it("heads the section once and names each record under it, one control per record", () => {
    renderPanel([eintrag("a", "Erster Eintrag", null), eintrag("b", "Zweiter Eintrag", null)]);

    assert.equal(screen.getAllByRole("heading", { level: 2, name: "Deine Einträge" }).length, 1);
    assert.deepEqual(
      screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent),
      ["Erster Eintrag", "Zweiter Eintrag"],
    );
    assert.equal(screen.getAllByRole("switch").length, 2);
  });

  /* Every seat's switch carries the same stamped words, so the group around each is what tells a
     screen reader which team season a press moves. */
  it("names each record's controls as a group by the record's title", () => {
    renderPanel([eintrag("a", "Erster Eintrag", null), eintrag("b", "Zweiter Eintrag", null)]);

    for (const titel of ["Erster Eintrag", "Zweiter Eintrag"]) {
      const gruppe = screen.getByRole("group", { name: titel });
      assert.equal(within(gruppe).getAllByRole("switch").length, 1, `the group „${titel}“ holds no switch of its own`);
    }
  });

  /* What was agreed stands apart from what the control now says, read-only and out of the way until asked for. */
  it("shows the confirmed words read-only behind their own disclosure", async () => {
    const user = userEvent.setup();
    renderPanel([eintrag("a", "Erster Eintrag", h("p", null, "Die Worte, denen zugestimmt wurde."))]);

    const trigger = screen.getByRole("button", { name: "Was Du bestätigt hast" });
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await user.click(trigger);

    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    const region = document.getElementById(trigger.getAttribute("aria-controls") ?? "") ?? assert.fail("the disclosure controls no region");
    assert.ok(within(region).getByText("Die Worte, denen zugestimmt wurde."));
    assert.equal(within(region).queryAllByRole("switch").length, 0, "the confirmed words carry a control");
  });

  /* The stamped words promise the person sees what is stored: a record's stored data stands under its
     own heading, a rung under the record's title, and a record serving none heads nothing. */
  it("shows a record's stored data under its own heading, and none for a record serving none", () => {
    renderPanel([
      eintrag("a", "Erster Eintrag", null, h("dl", null, h("dt", null, "Name"), h("dd", null, "Alina Fischer"))),
      eintrag("b", "Zweiter Eintrag", null),
    ]);

    const [erste, zweite] = [screen.getByRole("group", { name: "Erster Eintrag" }), screen.getByRole("group", { name: "Zweiter Eintrag" })];
    assert.ok(within(erste).getByRole("heading", { level: 4, name: "Deine Angaben" }));
    assert.ok(within(erste).getByText("Alina Fischer"));
    assert.equal(within(zweite).queryAllByRole("heading", { name: "Deine Angaben" }).length, 0, "a record serving no data heads some");
  });

  it("offers no disclosure for a record whose confirmed wording the registry does not hold", () => {
    renderPanel([eintrag("a", "Erster Eintrag", null)]);

    assert.equal(screen.queryAllByRole("button", { name: "Was Du bestätigt hast" }).length, 0);
  });
});
