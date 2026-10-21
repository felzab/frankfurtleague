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
const { deriveSpielberichtDraftStatus, draftOf, kontextOf } = await import("./spielberichtDraft.ts");
const { FLSpielberichtAdminResponseSchema, FLSpielberichtSchiedsrichterResponseSchema } = await import("../../../schemas.ts");

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
  await user.type(screen.getByRole("textbox", { name: /^Goethe-Gymnasium/ }), "1");
  await user.type(screen.getByRole("textbox", { name: /^Lessing-Gymnasium/ }), "0");
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

  /* A scorer ausgetragen since the match is in no squad the read serves, only in `genannt`: the picker and the change
     list would otherwise read the stored entry as unpicked and as a bare id. */
  it("keeps a stored scorer's name where no squad holds them any more", () => {
    const kontext = kontextOf({ ...LESEN, kader: { team1: [], team2: LESEN.kader.team2 }, genannt: LESEN.kader.team1 });
    render(
      underNext(
        h(SpielberichtForm, {
          leser: "schiedsrichter",
          spielId: BERICHT_SPIEL_ID,
          kontext,
          stored: LESEN.bericht,
          header: { title: "Goethe-Gymnasium gegen Lessing-Gymnasium" },
          zurueckHref: "/bereich/schiedsrichter",
        }),
        { router: nextRouter() },
      ),
    );

    assert.ok(
      screen.getAllByRole("button", { name: /Spielerin oder Spieler/ })[0]?.textContent?.includes("9 · Lina Berg"),
      "the picker reads unpicked",
    );

    const gespeichert = draftOf(LESEN.bericht);
    const status = deriveSpielberichtDraftStatus({ kontext, stored: gespeichert, draft: gespeichert, fieldErrors: {} });
    assert.equal(status.byPath.get("bericht.torschuetzen")?.storedText, "Goethe-Gymnasium: 9 · Lina Berg, 23.");
  });

  /* An erased scorer is served by id with both names null: the form reads them „anonym“, never as the bare id. */
  it("reads a stored scorer an erasure took as „anonym“", () => {
    const erased = LESEN.kader.team1.map((spieler) => ({ ...spieler, vorname: null, nachname: null, nummer: null }));
    const kontext = kontextOf({ ...LESEN, kader: { team1: [], team2: LESEN.kader.team2 }, genannt: erased });
    render(
      underNext(
        h(SpielberichtForm, {
          leser: "schiedsrichter",
          spielId: BERICHT_SPIEL_ID,
          kontext,
          stored: LESEN.bericht,
          header: { title: "Goethe-Gymnasium gegen Lessing-Gymnasium" },
          zurueckHref: "/bereich/schiedsrichter",
        }),
        { router: nextRouter() },
      ),
    );

    assert.equal(screen.getAllByRole("button", { name: /Spielerin oder Spieler/ })[0]?.textContent?.includes("anonym"), true);
    const gespeichert = draftOf(LESEN.bericht);
    const status = deriveSpielberichtDraftStatus({ kontext, stored: gespeichert, draft: gespeichert, fieldErrors: {} });
    assert.equal(status.byPath.get("bericht.torschuetzen")?.storedText, "Goethe-Gymnasium: anonym, 23.");
  });

  /* „45+2“ needs a „+“, which a digits keypad may not carry on the phone a referee fills the report in on. */
  it("asks for no digits-only keyboard in the minute box", async () => {
    const user = userEvent.setup();
    render(leer());
    await user.click(screen.getByRole("button", { name: "Tor hinzufügen" }));

    assert.equal(screen.getByRole("textbox", { name: "Minute" }).getAttribute("inputmode"), null);
  });

  /* A no-show takes no scorer: an entry left standing would ride into a save the backend refuses, unseen. */
  it("drops the scorers with a no-show and offers none", async () => {
    const user = userEvent.setup();
    render(leer());
    await user.click(screen.getByRole("button", { name: "Tor hinzufügen" }));

    await pick(user, screen.getByRole("button", { name: /^Sonderereignis/ }), "Nichtantreten Team 2");

    assert.equal(screen.queryAllByText("Tor 1").length, 0, "the scorer entry survived the no-show");
    assert.equal(screen.queryAllByRole("button", { name: "Tor hinzufügen" }).length, 0, "a no-show still offers a scorer");
    assert.ok(screen.getByText("Bei einem Nichtantreten gibt es keine Torschützen."));

    // Gone from the draft and not merely hidden: taking the no-show back finds no entry the referee left behind.
    await pick(user, screen.getByRole("button", { name: /^Sonderereignis/ }), "Keines");
    assert.equal(screen.queryAllByText("Tor 1").length, 0, "the hidden scorer entry still stands in the draft");
  });

  /* The administrator correcting a report is the league the referee's sentence names as someone else. */
  it("tells the administrator of a no-show where its result comes from, in their own words", async () => {
    const user = userEvent.setup();
    const gelesen = FLSpielberichtAdminResponseSchema.parse(spielberichtReadFixture());
    render(
      underNext(
        h(SpielberichtForm, {
          leser: "admin",
          spielId: BERICHT_SPIEL_ID,
          kontext: kontextOf(gelesen),
          stored: null,
          header: { title: "Goethe-Gymnasium gegen Lessing-Gymnasium" },
          zurueckHref: "/bereich/admin",
        }),
        { router: nextRouter() },
      ),
    );

    await pick(user, screen.getByRole("button", { name: /^Sonderereignis/ }), "Nichtantreten Team 2");

    assert.ok(screen.getByText(/stehen im Bericht keine Tore: Das Ergebnis ergibt sich im Spiel aus der Wertung\./));
    assert.equal(screen.queryAllByText(/trägst Du keine Tore ein/).length, 0, "the administrator is addressed as the referee");
  });

  /* The press reads „Speichern“ and the request went out, so the failure is the success negated, never „nicht gesendet“. */
  it("titles a refused save as not saved", async () => {
    const user = userEvent.setup();
    render(leer());
    await user.type(screen.getByRole("textbox", { name: /^Goethe-Gymnasium/ }), "0");
    await user.type(screen.getByRole("textbox", { name: /^Lessing-Gymnasium/ }), "0");
    answerWith(() => Promise.resolve({ success: false, error: "Dieses Spiel leitest Du nicht mehr. Lade die Seite neu." }));
    raised.length = 0;

    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await act(answered);

    assert.deepEqual(
      raised.filter(({ variant }) => variant === "danger").map(({ title }) => title),
      ["Spielbericht nicht gespeichert"],
    );
  });

  /* The shoot-out is offered exactly where the administrator's save keeps one: a group fixture's would be refused
     (`REQ-BERICHT-009`), and the reload the refusal advises redraws the same form. */
  it("offers no shoot-out on a level group fixture", async () => {
    const user = userEvent.setup();
    render(leer());
    await user.type(screen.getByRole("textbox", { name: /^Goethe-Gymnasium/ }), "1");
    await user.tab();
    await user.type(screen.getByRole("textbox", { name: /^Lessing-Gymnasium/ }), "1");
    await user.tab();

    assert.equal(screen.queryAllByRole("switch", { name: "Im Elfmeterschießen entschieden" }).length, 0);
  });

  /* Hidden once the score stops being level, a shoot-out left in the draft would be refused on a field no longer shown. */
  it("drops a knockout's shoot-out once the score stops being level, and sends the report without it", async () => {
    const user = userEvent.setup();
    render(
      underNext(
        h(SpielberichtForm, {
          leser: "schiedsrichter",
          spielId: BERICHT_SPIEL_ID,
          kontext: kontextOf({ ...LESEN, spiel: { ...LESEN.spiel, saison_phase: "achtelfinale" } }),
          stored: null,
          header: { title: "Goethe-Gymnasium gegen Lessing-Gymnasium" },
          zurueckHref: "/bereich/schiedsrichter",
        }),
        { router: nextRouter() },
      ),
    );
    const [tore1] = screen.getAllByRole("textbox", { name: /^Goethe-Gymnasium/ });
    await user.type(tore1 ?? assert.fail("no goal box"), "0");
    await user.tab();
    await user.type(screen.getByRole("textbox", { name: /^Lessing-Gymnasium/ }), "0");
    await user.tab();
    await user.click(screen.getByRole("switch", { name: "Im Elfmeterschießen entschieden" }));
    await user.type(screen.getByRole("textbox", { name: /^Goethe-Gymnasium: Treffer/ }), "4");
    await user.tab();
    await user.type(screen.getByRole("textbox", { name: /^Lessing-Gymnasium: Treffer/ }), "3");
    await user.tab();

    await user.clear(tore1 ?? assert.fail("no goal box"));
    await user.type(tore1 ?? assert.fail("no goal box"), "1");
    await user.tab();
    assert.equal(screen.queryAllByRole("switch", { name: "Im Elfmeterschießen entschieden" }).length, 0, "a 1:0 offers a shoot-out");
    await user.click(screen.getByRole("button", { name: "Tor hinzufügen" }));
    await pick(user, screen.getByRole("button", { name: /^Team/ }), "Goethe-Gymnasium");
    await pick(user, screen.getByRole("button", { name: /Spielerin oder Spieler/ }), "unbekannt");
    await user.type(screen.getByRole("textbox", { name: "Minute" }), "70");
    await user.tab();
    calls.length = 0;

    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await act(answered);

    assert.equal(calls.length, 1, "the corrected report was refused on the shoot-out it no longer shows");
    const bericht = Reflect.get(Object(calls[0]?.payload), "bericht") as { ergebnis_vorschlag: unknown };
    assert.deepEqual(bericht.ergebnis_vorschlag, { team1_tore: 1, team2_tore: 0, elfmeterschiessen: null, sonderereignis: null });
  });

  /* The season-end strip deleted the caution's reason: a correction that owed it again would make the administrator
     invent the reason the strip removed (`REQ-BERICHT-008`), so the stored cards excuse it at the box and in its mark. */
  it("sends an administrator's correction over a caution stripped of its reason, which it neither marks nor asks for", async () => {
    const user = userEvent.setup();
    const gelesen = FLSpielberichtAdminResponseSchema.parse(spielberichtReadFixture());
    const gestrippt =
      gelesen.bericht === null
        ? null
        : { ...gelesen.bericht, bemerkungen: null, karten: gelesen.bericht.karten.map((karte) => ({ ...karte, grund: null })) };
    render(
      underNext(
        h(SpielberichtForm, {
          leser: "admin",
          spielId: BERICHT_SPIEL_ID,
          kontext: kontextOf(gelesen),
          stored: gestrippt,
          header: { title: "Goethe-Gymnasium gegen Lessing-Gymnasium" },
          zurueckHref: "/bereich/admin",
        }),
        { router: nextRouter() },
      ),
    );
    // A boolean, never the node: a failing comparison would serialise the whole form.
    assert.equal(
      document.querySelector('[name="bericht.karten.0.grund"]')?.closest('[data-required="true"]') != null,
      false,
      "the stripped caution's reason is marked as owed",
    );
    await user.type(screen.getByRole("textbox", { name: /Bemerkungen zum Spiel/ }), "Protest nach Abpfiff.");
    calls.length = 0;

    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await act(answered);

    assert.equal(calls.length, 1, "the correction was refused at the stripped caution's reason");
    assert.equal(calls[0]?.action, "patchAdminSpielberichtAction");
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
      // No entry of the moved side named anybody, so the banner claims no removal.
      assert.equal(screen.queryAllByText(/aus ihren Einträgen genommen/).length, 0, "the banner claims a removal nobody underwent");
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
      assert.ok(screen.getByText(/aus ihren Einträgen genommen/), "the banner leaves the removal unsaid");
      calls.length = 0;

      await user.click(screen.getByRole("button", { name: "Speichern" }));
      await act(answered);

      assert.deepEqual(calls, [], "a card naming the departed club's pupil was sent, which the backend refuses");
    });
  });
});
