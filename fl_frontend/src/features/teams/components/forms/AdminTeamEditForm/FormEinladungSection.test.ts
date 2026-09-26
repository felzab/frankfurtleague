import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { closedControl, isInTheFlow } from "@/shared/testing/closedControl.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";

import type { FLEinladung } from "@/features/einladungen/schemas.ts";

/** A write nobody has answered yet, which is how each action answers unless a case says otherwise. */
const running = (): Promise<never> => new Promise(() => undefined);

const { calls, answerWith } = doubleActions({ modules: ["/src/features/einladungen/actions.ts"], answer: running });

/** The payloads one action was sent, in the order the panel sent them. */
const sent = (action: string): unknown[] => calls.filter((call) => call.action === action).map((call) => call.payload);

const { raised } = doubleToasts();

const { EinladungLinkHolder } = await import("@/features/einladungen/components/EinladungLinkHolder.tsx");
const { FormEinladungSection } = await import("./FormEinladungSection.tsx");
/** The ruling's words for a mint of unknown outcome, whose token nothing can show again. */
const MINT_UNKLAR = "Lade die Seite neu. Steht dort ein Link, ziehe ihn zurück und erstelle einen neuen.";

const TEAM_ID = "a".repeat(24);
const EINLADUNG_ID = "b".repeat(24);
/** Four characters, the width every schema in the tree holds a season id to. */
const SAISON_ID = "2627";

/** The value the mint answers and nothing else ever holds, spelled so a case can search the page for it. */
const TOKEN = "geheimer-linkwert";
const LINK = `http://localhost:3000/registrierung?token=${TOKEN}`;

const LIVE: FLEinladung = {
  id: EINLADUNG_ID,
  saison_id: SAISON_ID,
  team_id: TEAM_ID,
  erstellt_am: "2026-09-01",
  erstellt_von: "vorstand@beispiel.de",
  widerrufen_am: null,
  // The carrier as the WIRE sends it for an invitation nobody has mailed: the mint writes `{}`, and
  // the endpoint serialises the key with `null` in it. A record here would never exercise the
  // absence the panel words.
  versand: { zustellung: null },
};

type PanelProps = Parameters<typeof FormEinladungSection>[0];

const BASE: PanelProps = {
  teamId: TEAM_ID,
  saisonId: SAISON_ID,
  isMember: true,
  isFinishedSaison: false,
  einladung: null,
  laeuft: true,
};

/** Under the holder the page renders outside its keyed subtree, which is where the minted link lives. */
const panel = (props: Partial<PanelProps> = {}) =>
  underNext(h(EinladungLinkHolder, { scope: `${TEAM_ID}:${SAISON_ID}`, children: h(FormEinladungSection, { ...BASE, ...props }) }));

const mintAntwort = () =>
  Promise.resolve({ success: true, einladung_id: EINLADUNG_ID, token: TOKEN, link: LINK, message: "Der neue Link gilt." });

beforeEach(() => {
  calls.length = 0;
  raised.length = 0;
  answerWith(running);
});

describe("the team's invite panel", () => {
  it("offers one press and nothing to withdraw where the team holds no link", () => {
    render(panel());

    assert.ok(screen.getByRole("button", { name: "Registrierungslink anlegen" }));
    assert.ok(screen.queryByRole("button", { name: "Link zurückziehen" }) === null, "a team with no link is offered a withdrawal");
    assert.ok(screen.queryByRole("textbox", { name: "Registrierungslink" }) === null, "a link nobody has minted is on the page");
  });

  /* The mint shows the link for copying, and a second press is what mails it. Both controls
     appear with the value, because neither can do anything without it. */
  it("shows the minted link once, with the copy and the mail press beside it", async () => {
    const user = userEvent.setup();
    answerWith(mintAntwort);
    render(panel());

    await user.click(screen.getByRole("button", { name: "Registrierungslink anlegen" }));

    assert.deepEqual(sent("postEinladungAction"), [{ team_id: TEAM_ID, saison_id: SAISON_ID }]);
    // Found rather than got: the first mint's update commits when `startMinting`'s transition ends,
    // after the click has resolved.
    const feld = await screen.findByRole("textbox", { name: "Registrierungslink" });
    // The property and not the attribute: React writes a textarea's value as neither markup nor an
    // attribute, so an attribute read here would compare the empty string against the link forever.
    assert.equal((feld as HTMLTextAreaElement).value, LINK);
    assert.ok(screen.getByRole("button", { name: "Link kopieren" }));
    assert.ok(screen.getByRole("button", { name: "Link per E-Mail senden" }));
    assert.ok(isInTheFlow("Der Link selbst wird nicht gespeichert"), "nothing says the value is gone when the page is left");
  });

  /* Held in this panel, the one copy of the link would go with the remount every other panel's save
     causes, and no read can serve it back. */
  it("keeps the minted link through a remount of the editor's subtree, and drops it when the scope moves", async () => {
    const user = userEvent.setup();
    answerWith(mintAntwort);
    const held = (scope: string, subtree: string) =>
      underNext(h(EinladungLinkHolder, { scope: scope, children: h("div", { key: subtree }, h(FormEinladungSection, BASE)) }));
    const wert = () => (screen.queryByRole("textbox", { name: "Registrierungslink" }) as HTMLTextAreaElement | null)?.value ?? null;

    const { rerender } = render(held(`${TEAM_ID}:${SAISON_ID}`, "vor dem Speichern"));
    await user.click(screen.getByRole("button", { name: "Registrierungslink anlegen" }));
    await screen.findByRole("textbox", { name: "Registrierungslink" });
    assert.equal(wert(), LINK, "the mint never put the value on the page, so the two reads below prove nothing");

    // The key the editor wears is the stored state a save moves, so any other panel's save remounts
    // this one whole.
    rerender(held(`${TEAM_ID}:${SAISON_ID}`, "nach dem Speichern"));
    assert.equal(wert(), LINK, "a save on another panel took the link with it, and nothing can serve it back");

    rerender(held(`${"c".repeat(24)}:${SAISON_ID}`, "nach dem Speichern"));
    assert.equal(wert(), null, "one team's link stood on another team's page");
  });

  /* The edge cutting the request rejects the action after the row may have been written, and a
     rejection left to `startMinting`'s transition replaces the page with the error page. */
  it("stays on the page over a rejected first mint, and names the way back to a link that may exist", async () => {
    const user = userEvent.setup();
    answerWith(() => Promise.reject(new Error("An unexpected response was received from the server.")));
    render(panel());

    await user.click(screen.getByRole("button", { name: "Registrierungslink anlegen" }));
    // Found rather than got: the press lets go once the rejection has been answered.
    await screen.findByRole("button", { name: "Registrierungslink anlegen" });

    assert.deepEqual(
      raised.map((toast) => [toast.variant, toast.title, toast.description, toast.options?.outcome]),
      [["danger", "Registrierungslink nicht angelegt", MINT_UNKLAR, "unknown"]],
    );
  });

  /* A replacement mints too, and the token it may have minted is as gone with the cut answer. */
  it("names the way back to a link after a cut replacement", async () => {
    const user = userEvent.setup();
    render(panel({ einladung: LIVE }));

    await user.click(screen.getByRole("radio", { name: "Ersetzen" }));
    await pressTwice(user, {
      resting: "Neuen Link anlegen",
      armed: "Ja, neuen Link anlegen",
      whileArmed: () => answerWith(() => Promise.reject(new Error("An unexpected response was received from the server."))),
    });
    await waitFor(() => assert.equal(raised.length, 1));

    assert.deepEqual(
      raised.map((toast) => [toast.title, toast.description, toast.options?.outcome]),
      [["Registrierungslink nicht angelegt", MINT_UNKLAR, "unknown"]],
    );
  });

  it("sends the mail press the row the mint named and the value it answered", async () => {
    const user = userEvent.setup();
    answerWith(mintAntwort);
    render(panel());

    await user.click(screen.getByRole("button", { name: "Registrierungslink anlegen" }));
    answerWith(() => Promise.resolve({ success: true, message: "Der Link ist an 2 von 2 Adressen unterwegs." }));
    // Found rather than got, as the mint's own case finds its link: the press appears when
    // `startMinting`'s transition ends, which no click's resolving waits for.
    await user.click(await screen.findByRole("button", { name: "Link per E-Mail senden" }));

    assert.deepEqual(sent("mailEinladungAction"), [{ team_id: TEAM_ID, saison_id: SAISON_ID, einladung_id: EINLADUNG_ID, token: TOKEN }]);
    assert.equal(raised.at(-1)?.variant, "success");
  });

  /* The store keeps a hash, so a reload cannot serve the value back. The panel states the row and
     its delivery state; the mail press is absent because there is nothing left to put in a message. */
  it("states a standing link without its value, and offers no mail press on a reloaded page", () => {
    render(panel({ einladung: LIVE }));

    assert.ok(isInTheFlow("01.09.2026"), "the day the standing link was minted is not stated");
    assert.ok(isInTheFlow("vorstand@beispiel.de"), "the administrator who minted it is not named");
    assert.ok(isInTheFlow("Noch nicht gesendet"), "an unmailed link reads as a delivery that failed");
    assert.ok(screen.queryByRole("textbox", { name: "Registrierungslink" }) === null, "a reloaded page shows a value the store does not hold");
    assert.equal(document.body.textContent.includes(TOKEN), false, "the link value survived the reload the store cannot serve it back from");
    assert.ok(
      screen.queryByRole("button", { name: "Link per E-Mail senden" }) === null,
      "a mail press stands with no link to put in a message",
    );
  });

  /* Both writes end the standing link, so a preselection would arm the one nobody read: the pick is
     what lifts the closure, and the reveal then names that one operation's loss. */
  it("offers no armed press until the operation is picked", () => {
    render(panel({ einladung: LIVE }));

    closedControl("Neuen Link anlegen", "Wähle, was mit dem offenen Link passieren soll.");
    assert.ok(screen.getByRole("radio", { name: "Ersetzen" }));
    assert.ok(screen.getByRole("radio", { name: "Zurückziehen" }));
  });

  /* A re-mint revokes the standing link inside the same transaction, so everyone holding the old one
     loses it: that is a write nothing reverses, and it escalates rather than firing on one press. */
  it("escalates the replacement, naming what the standing link loses", async () => {
    const user = userEvent.setup();
    render(panel({ einladung: LIVE }));

    await user.click(screen.getByRole("radio", { name: "Ersetzen" }));
    await pressTwice(user, {
      resting: "Neuen Link anlegen",
      armed: "Ja, neuen Link anlegen",
      whileArmed: () => {
        assert.equal(sent("postEinladungAction").length, 0, "one press replaced the link");
        assert.match(screen.getByRole("alert").textContent, /öffnet danach nichts mehr/);
        answerWith(mintAntwort);
      },
    });

    assert.deepEqual(sent("postEinladungAction"), [{ team_id: TEAM_ID, saison_id: SAISON_ID }]);
  });

  it("escalates the withdrawal, and writes nothing on the arming press", async () => {
    const user = userEvent.setup();
    render(panel({ einladung: LIVE }));

    await user.click(screen.getByRole("radio", { name: "Zurückziehen" }));
    await pressTwice(user, {
      resting: "Link zurückziehen",
      armed: "Ja, Link zurückziehen",
      whileArmed: () => {
        assert.equal(sent("deleteEinladungAction").length, 0, "one press withdrew the link");
        assert.match(screen.getByRole("alert").textContent, /kein Link mehr offen/);
        answerWith(() => Promise.resolve({ success: true, message: "Der Link öffnet ab sofort nichts mehr." }));
      },
    });

    assert.deepEqual(sent("deleteEinladungAction"), [{ team_id: TEAM_ID, saison_id: SAISON_ID }]);
  });

  /* The reveal names one operation's loss, so a pick moving under an armed panel would have the
     second press confirm what the first one never described. */
  it("disarms when the pick moves", async () => {
    const user = userEvent.setup();
    render(panel({ einladung: LIVE }));

    await user.click(screen.getByRole("radio", { name: "Ersetzen" }));
    await user.click(screen.getByRole("button", { name: "Neuen Link anlegen" }));
    assert.ok(screen.getByRole("alert"), "the arming press never armed, so the disarm below proves nothing");

    await user.click(screen.getByRole("radio", { name: "Zurückziehen" }));

    assert.ok(screen.queryByRole("alert") === null, "the armed step survived a pick it does not describe");
    assert.ok(screen.getByRole("button", { name: "Link zurückziehen" }), "the control still offers the operation it was armed for");
  });

  it("explains a club outside the season rather than offering it a press", () => {
    render(panel({ isMember: false }));

    assert.ok(isInTheFlow("Einen Registrierungslink bekommt nur ein Team, das in dieser Saison steht"));
    assert.ok(screen.queryByRole("button", { name: "Registrierungslink anlegen" }) === null, "a club outside the season is offered a mint");
  });

  /* A link outlives a shut window and opens nothing while it is shut, so the panel says which of the
     two states the reader is looking at rather than closing a press the endpoint would accept. */
  it("says the window is shut and still offers the mint", () => {
    render(panel({ laeuft: false }));

    assert.ok(isInTheFlow("Die Registrierung für diese Saison ist gerade nicht geöffnet"));
    assert.ok(screen.getByRole("button", { name: "Registrierungslink anlegen" }));
  });
});
