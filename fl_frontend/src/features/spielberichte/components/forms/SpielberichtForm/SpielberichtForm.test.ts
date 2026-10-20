import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { nextRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { BERICHT_SPIEL_ID, spielberichtReadFixture } from "@/shared/testing/spielberichtFixtures.ts";

/* Every save answers as landed; the form reaches the stub along the path it reaches the action. */
const { calls, answered } = doubleActions({
  modules: ["/src/features/spielberichte/personActions.ts", "/src/features/spielberichte/actions.ts"],
  payloadOf: (args) => args[1],
});
doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SpielberichtForm } = await import("./SpielberichtForm.tsx");
const { kontextOf } = await import("./spielberichtDraft.ts");
const { FLSpielberichtSchiedsrichterResponseSchema } = await import("../../../schemas.ts");

const LESEN = FLSpielberichtSchiedsrichterResponseSchema.parse(spielberichtReadFixture());

/** The referee's form on the fixture with nothing reported yet. */
const leer = () =>
  underNext(
    h(SpielberichtForm, {
      leser: "schiedsrichter",
      spielId: BERICHT_SPIEL_ID,
      kontext: kontextOf(LESEN),
      stored: null,
      header: { title: "Goethe-Gymnasium gegen Lessing-Gymnasium" },
      zurueckHref: "/bereich/schiedsrichter",
    }),
    { router: nextRouter() },
  );

type User = ReturnType<typeof userEvent.setup>;

const pick = async (user: User, trigger: HTMLElement, option: string) => {
  await user.click(trigger);
  await user.click(screen.getByRole("option", { name: option }));
};

/** A 1:0 typed into the goal boxes. */
async function eintragen(user: User): Promise<void> {
  await user.type(screen.getByRole("textbox", { name: /Tore Goethe-Gymnasium/ }), "1");
  await user.type(screen.getByRole("textbox", { name: /Tore Lessing-Gymnasium/ }), "0");
}

describe("the referee's report form", () => {
  /* The count rule is the form's own gate: a goal without an entry never reaches the action. */
  it("sends nothing for a goal without an entry, and says why under the list", async () => {
    const user = userEvent.setup();
    render(leer());
    await eintragen(user);
    calls.length = 0;

    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await act(answered);

    assert.deepEqual(calls, [], "a report the count rule refuses was sent");
    assert.ok(screen.getByText(/Für jedes Tor braucht es genau einen Eintrag/));
  });

  /* „unbekannt“ is an entry naming nobody, so it reaches the wire as a null id and never as the picker's word. */
  it("sends an own goal by an unknown scorer as a null id on the scorer's side", async () => {
    const user = userEvent.setup();
    render(leer());
    await eintragen(user);
    await user.click(screen.getByRole("button", { name: "Tor hinzufügen" }));
    await pick(user, screen.getByRole("button", { name: /^Team/ }), "Lessing-Gymnasium");
    await pick(user, screen.getByRole("button", { name: /Spielerin oder Spieler/ }), "unbekannt");
    await user.type(screen.getByRole("textbox", { name: "Minute" }), "88");
    await user.click(screen.getByRole("switch", { name: "Eigentor" }));
    calls.length = 0;

    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await act(answered);

    assert.deepEqual(calls, [
      {
        action: "putSpielberichtAction",
        payload: {
          bericht: {
            ergebnis_vorschlag: { team1_tore: 1, team2_tore: 0, elfmeterschiessen: null, sonderereignis: null },
            torschuetzen: [{ seite: "team2", spieler_id: null, minute: "88", eigentor: true }],
            karten: [],
            bemerkungen: null,
          },
          bericht_stand: null,
        },
      },
    ]);
  });

  /* The backend refuses a write composed on another version (`REQ-BERICHT-006`), so the form names the one it opened on:
     sending none, or the latest, would let it replace a correction its reader never saw. */
  it("sends the version of the report it opened on", async () => {
    const user = userEvent.setup();
    const gelesen = FLSpielberichtSchiedsrichterResponseSchema.parse(spielberichtReadFixture());
    render(
      underNext(
        h(SpielberichtForm, {
          leser: "schiedsrichter",
          spielId: BERICHT_SPIEL_ID,
          kontext: kontextOf(gelesen),
          stored: gelesen.bericht === null ? null : { ...gelesen.bericht, version: 4 },
          header: { title: "Goethe-Gymnasium gegen Lessing-Gymnasium" },
          zurueckHref: "/bereich/schiedsrichter",
        }),
        { router: nextRouter() },
      ),
    );
    await user.type(screen.getByRole("textbox", { name: /Bemerkungen zum Spiel/ }), " Nachspielzeit fünf Minuten.");
    calls.length = 0;

    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await act(answered);

    assert.equal(calls.length, 1, "the edited report was not sent");
    assert.equal(Reflect.get(Object(calls[0]?.payload), "bericht_stand"), 4);
  });
});
