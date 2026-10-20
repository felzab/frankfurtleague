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
const { calls, answered, answerWith } = doubleActions({
  modules: ["/src/features/spielberichte/personActions.ts", "/src/features/spielberichte/actions.ts"],
  payloadOf: (args) => args[1],
});
const { raised } = doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SpielberichtForm } = await import("./SpielberichtForm.tsx");
const { kontextOf } = await import("./spielberichtDraft.ts");
const { FLSpielberichtSchiedsrichterResponseSchema } = await import("../../../schemas.ts");

const LESEN = FLSpielberichtSchiedsrichterResponseSchema.parse(spielberichtReadFixture());

/** The referee's form on the fixture with nothing reported yet, over both squads unless a case names others. */
const leer = (kader: typeof LESEN.kader = LESEN.kader) =>
  underNext(
    h(SpielberichtForm, {
      leser: "schiedsrichter",
      spielId: BERICHT_SPIEL_ID,
      kontext: kontextOf({ ...LESEN, kader }),
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

  /* A no-show takes no scorer: an entry left standing would ride into a save the backend refuses, unseen. */
  it("drops the scorers with a no-show and offers none", async () => {
    const user = userEvent.setup();
    render(leer());
    await user.click(screen.getByRole("button", { name: "Tor hinzufügen" }));

    await pick(user, screen.getByRole("button", { name: /^Besonderes Ereignis/ }), "Nichtantreten Team 2");

    assert.equal(screen.queryAllByText("Tor 1").length, 0, "the scorer entry survived the no-show");
    assert.equal(screen.queryAllByRole("button", { name: "Tor hinzufügen" }).length, 0, "a no-show still offers a scorer");
    assert.ok(screen.getByText("Bei einem Nichtantreten gibt es keine Torschützen."));

    // Gone from the draft and not merely hidden: taking the no-show back finds no entry the referee left behind.
    await pick(user, screen.getByRole("button", { name: /^Besonderes Ereignis/ }), "Keines");
    assert.equal(screen.queryAllByText("Tor 1").length, 0, "the hidden scorer entry still stands in the draft");
  });

  /* The success toast reads „Spielbericht gesendet“, so its failure is that title negated. */
  it("titles a refused send as not sent", async () => {
    const user = userEvent.setup();
    render(leer());
    await user.type(screen.getByRole("textbox", { name: /Tore Goethe-Gymnasium/ }), "0");
    await user.type(screen.getByRole("textbox", { name: /Tore Lessing-Gymnasium/ }), "0");
    answerWith(() => Promise.resolve({ success: false, error: "Dieses Spiel leitest Du nicht mehr. Lade die Seite neu." }));
    raised.length = 0;

    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await act(answered);

    assert.deepEqual(
      raised.filter(({ variant }) => variant === "danger").map(({ title }) => title),
      ["Spielbericht nicht gesendet"],
    );
  });

  /* A side fielding no squad offers a picker with nobody in it, which says nothing of what the referee does instead. */
  it("says what to enter where a side has no squad", async () => {
    const user = userEvent.setup();
    render(leer({ team1: LESEN.kader.team1, team2: [] }));
    await user.click(screen.getByRole("button", { name: "Tor hinzufügen" }));

    await pick(user, screen.getByRole("button", { name: /^Team/ }), "Lessing-Gymnasium");

    assert.ok(screen.getByText(/Für dieses Team ist kein Kader hinterlegt\. Jedes Tor trägst Du dann als „unbekannt“ ein\./));
  });

  /* A knockout correction re-fielded team 2 since the report: the backend reads it `teams_geaendert` until a write stamps
     the clubs playing now, so a save that changes nothing else must still go out. */
  describe("on a report about a club that has left the fixture", () => {
    const umbesetzt = (lesen: ReturnType<typeof spielberichtReadFixture>) => {
      const gelesen = FLSpielberichtSchiedsrichterResponseSchema.parse({ ...lesen, seiten_geaendert: ["team2"] });
      return underNext(
        h(SpielberichtForm, {
          leser: "schiedsrichter",
          spielId: BERICHT_SPIEL_ID,
          kontext: kontextOf(gelesen),
          stored: gelesen.bericht,
          header: { title: "Goethe-Gymnasium gegen Lessing-Gymnasium" },
          zurueckHref: "/bereich/schiedsrichter",
        }),
        { router: nextRouter() },
      );
    };

    it("says so and sends the report unchanged, written for the clubs playing now", async () => {
      const user = userEvent.setup();
      const ohneKarte = spielberichtReadFixture();
      render(umbesetzt({ ...ohneKarte, bericht: { ...ohneKarte.bericht, karten: [] } }));
      assert.ok(screen.getByText("Im Spiel stehen inzwischen andere Teams"));
      calls.length = 0;

      await user.click(screen.getByRole("button", { name: "Speichern" }));
      await act(answered);

      assert.equal(calls.length, 1, "the unchanged report was not sent, so its clubs stay unstamped");
    });

    it("takes the departed club's pupil out of its entry and marks it", async () => {
      const user = userEvent.setup();
      const gelesen = spielberichtReadFixture();
      // Team 2's squad is the new club's: the stored card names a pupil of the club that left.
      render(umbesetzt({ ...gelesen, kader: { ...gelesen.kader, team2: [] } }));
      assert.ok(screen.getByText("Die eingetragene Person spielt nicht für dieses Team. Wähle die Person neu."));
      calls.length = 0;

      await user.click(screen.getByRole("button", { name: "Speichern" }));
      await act(answered);

      assert.deepEqual(calls, [], "a card naming the departed club's pupil was sent, which the backend refuses");
    });
  });
});
