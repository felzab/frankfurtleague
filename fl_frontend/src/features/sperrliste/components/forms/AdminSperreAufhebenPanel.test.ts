import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";

/** The removal itself: a real one needs a session and a backend. */
const { calls, answerWith } = doubleActions({ modules: ["/src/features/sperrliste/actions.ts"] });

const { raised } = doubleToasts();

const { AdminSperreAufhebenPanel } = await import("./AdminSperreAufhebenPanel.tsx");
const { unansweredAction } = await import("@/shared/utils/actionError.ts");
const { SPERRE_AUFHEBEN_CONSEQUENCE } = await import("@/features/sperrliste/constants.ts");

const SPERRE_ID = "6890a1b2c3d4e5f607190001";
const GESPERRT_AM = "12.03.2026";

const RESTING = `Sperre vom ${GESPERRT_AM} aufheben`;
const ARMED = `Ja, Sperre vom ${GESPERRT_AM} endgültig aufheben`;

const mount = (): void => {
  render(underNext(h(AdminSperreAufhebenPanel, { sperreId: SPERRE_ID, gesperrtAm: GESPERRT_AM })));
};

beforeEach(() => {
  calls.length = 0;
  raised.length = 0;
  answerWith(() => Promise.resolve({ success: true, message: "Diese Adresse wird nicht mehr abgewiesen." }));
});

describe("lifting one ban from the row it stands on", () => {
  /* The reason reaches this panel through no prop at all, so the names below can only be the day's:
     `AdminSperrlisteList.test.ts` reads the rendered names against the reasons a card really holds. */
  it("names the ban it would lift, and takes no write on the first press", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: RESTING }));

    assert.deepEqual(calls, [], "the first press writes");
    assert.ok(screen.getByRole("alert").textContent?.includes(SPERRE_AUFHEBEN_CONSEQUENCE), "the armed state says nothing about the cost");
    assert.ok(screen.getByRole("button", { name: ARMED }), "the armed control is not named for the ban it would lift");
  });

  it("removes the ban on the second press and says so", async () => {
    const user = userEvent.setup();
    mount();

    await pressTwice(user, { resting: RESTING, armed: ARMED });

    assert.deepEqual(calls, [{ action: "deleteSperreAction", payload: { id: SPERRE_ID } }]);
    assert.deepEqual(raised, [
      {
        variant: "success",
        title: "Sperre aufgehoben",
        description: "Diese Adresse wird nicht mehr abgewiesen.",
        options: { description: "Diese Adresse wird nicht mehr abgewiesen." },
      },
    ]);
  });

  /* The failure title is the success one negated (`docs/frontend/spec.md :: I250`), and the server's
     own sentence is the body: an administrator who reads „aufgehoben“ over a refused write stops
     looking. */
  it("says the ban still stands when the write is refused", async () => {
    const user = userEvent.setup();
    answerWith(() => Promise.resolve({ success: false, error: "Der Eintrag wurde nicht gefunden. Lade die Seite neu." }));
    mount();

    await pressTwice(user, { resting: RESTING, armed: ARMED });

    assert.equal(raised.length, 1);
    assert.equal(raised[0]?.variant, "danger");
    assert.equal(raised[0]?.title, "Sperre nicht aufgehoben");
    assert.equal(raised[0]?.description, "Der Eintrag wurde nicht gefunden. Lade die Seite neu.");
  });

  /* The edge cutting the request rejects the action after the removal may have landed, and a
     rejection left to the press's transition replaces the page with the error page. */
  it("stays on the page over a rejected removal, and says nobody can tell whether the ban went", async () => {
    const user = userEvent.setup();
    answerWith(() => Promise.reject(new Error("An unexpected response was received from the server.")));
    mount();

    await pressTwice(user, { resting: RESTING, armed: ARMED });
    // Found rather than got: the press lets go once the rejection has been answered.
    await screen.findByRole("button", { name: RESTING });

    const { error, outcome } = unansweredAction();
    assert.deepEqual(
      raised.map((toast) => [toast.variant, toast.title, toast.description, toast.options?.outcome]),
      [["danger", "Sperre nicht aufgehoben", error, outcome]],
    );
  });
});
