import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { APINetworkError } from "@/core/errors.ts";
import { DOUBLE_PRESS_MS } from "@/shared/hooks/useTwoPressConfirm.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { closedControl } from "@/shared/testing/closedControl.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";
import { toActionErrorResult } from "@/shared/utils/actionError.ts";

/** The panel's read and its write alike: a real one needs a session and a backend. */
const { calls, answerWith, answerPending } = doubleActions({
  modules: ["/src/features/kontakte/actions.ts"],
  answer: () => new Promise(() => undefined),
});

const { raised } = doubleToasts();

const { FormKontaktErasure } = await import("./FormKontaktErasure.tsx");

/** The read no connection answered, as the panel words it. */
const OHNE_VERBINDUNG =
  "Die Übersicht, wer dabei gelöscht wird, konnte nicht geladen werden, und ohne sie wird nichts gelöscht. " +
  "Lade die Seite neu und versuche es erneut.";

/** The read the backend never answered in time, as the panel words it. */
const OHNE_ANTWORT =
  "Die Übersicht, wer dabei gelöscht wird, konnte nicht geladen werden, und ohne sie wird nichts gelöscht. " +
  "Der Server hat zu lange nicht geantwortet. Versuche es erneut.";

/** The names the arming read answers with, which the confirming press is taken over. */
const ANSICHT = { success: true, ansicht: { acknowledged: 1, saison_teams: [], bewerbungen: [] } };

const RESTING = "Kontaktperson löschen";
const ARMED = "Ja, Kontaktperson endgültig löschen";

/** The read's answer arriving, and everything it sets off. */
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** How often the write itself ran: the double records the panel's read under the same roster. */
const erasures = (): number => calls.filter(({ action }) => action === "eraseKontaktpersonAction").length;

/** How often one severity was raised, the double recording every toast of the file. */
const toastsOf = (variant: string): number => raised.filter((toast) => toast.variant === variant).length;

// Emptied per case, the two doubles recording for the whole file.
beforeEach(() => {
  calls.length = 0;
  raised.length = 0;
});

function renderPanel() {
  const user = userEvent.setup({ delay: null });
  const view = render(underNext(h(FormKontaktErasure, { email: "ada@example.org", fullName: "Ada Byron", isDirty: false })));

  return { user, unmount: view.unmount };
}

describe("the person's erasure over its arming read", () => {
  /* The names ARE the confirmation, so a refused read closes the press; closed without a reason, a reader
     meets a dead button and nothing on it says the list is what is missing (`docs/frontend/spec.md` §1.14). */
  it("says on the closed press what the reveal says, and how to read the list again", async () => {
    answerWith(() => Promise.reject(new TypeError("Failed to fetch")));
    const { user } = renderPanel();

    await user.click(screen.getByRole("button", { name: RESTING }));
    await settle();

    closedControl(ARMED, OHNE_VERBINDUNG);
    assert.ok(
      screen.queryAllByText(OHNE_VERBINDUNG).some((sentence) => sentence.closest("[hidden]") === null),
      "the armed reveal says less than the closed press",
    );
  });

  /* A backend stalled past the client's timeout, answered as `runAdminMutation` answers this read-only
     POST: the read changed nothing, so the reveal says the list failed to load and never that an
     erasure may stand. */
  it("words a read the backend stalled as a failed read, never as an outcome unknown", async () => {
    const stalled = new APINetworkError({
      message: "timed out",
      url: "http://localhost/api/v0/kontakte/erasure/ansicht",
      method: "POST",
      readOnly: true,
      traceId: "0",
      isTimeout: true,
    });
    answerWith(() => Promise.resolve(toActionErrorResult(stalled, { method: "POST", readOnly: true })));
    const { user } = renderPanel();

    await user.click(screen.getByRole("button", { name: RESTING }));
    await settle();

    closedControl(ARMED, OHNE_ANTWORT);
    assert.equal(screen.queryAllByText(/ist unklar/).length, 0, "a read that stored nothing is worded as a write that may stand");
  });

  /* A read still running ends by itself, as a running write does, so it names no reason; the press is held
     rather than closed, keeping the focus the arming press left on it, and erases nothing until the names stand. */
  it("holds the press while the read runs, and erases once the names are on screen", async (t) => {
    let answer: (read: unknown) => void = () => undefined;
    answerWith(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    /* The clock spelled here rather than through `pressTwice`, which ticks the window only after the
       arming press: the refused press below has to be past it, so that the hold is what refuses it. */
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const { user } = renderPanel();

    await user.click(screen.getByRole("button", { name: RESTING }));
    const confirm = screen.getByRole("button", { name: ARMED });
    t.mock.timers.tick(DOUBLE_PRESS_MS);

    await user.click(confirm);
    assert.equal(erasures(), 0, "the press erased over the placeholder");
    assert.equal(confirm.hasAttribute("disabled"), false, "the running read closes the press, dropping the focus on it");
    assert.equal(confirm.getAttribute("data-pending"), "true", "a read still running closes the press rather than holding it");
    assert.equal(
      screen.queryAllByRole("button", { name: /Kontaktperson endgültig löschen/, description: /./ }).length,
      0,
      "a read still running names a reason",
    );

    // The write left hanging, so the confirming press below is counted rather than reported.
    answerWith(() => new Promise(() => undefined));
    await act(async () => {
      answer(ANSICHT);
    });
    await user.click(confirm);

    assert.equal(erasures(), 1, "the press stays held over the names it is confirmed over");
    await act(async () => answerPending({ success: true, cleared: 1, message: "" }));
  });
});

describe("what an erasure reports once it has run", () => {
  /* The endpoint refuses nothing, so an address matching nobody succeeds and clears zero: reported as
     „gelöscht“, that is a deletion nobody made. */
  it("calls a write that found nobody a miss, and one that cleared somebody a deletion", async () => {
    for (const [cleared, variant] of [
      [0, "warning"],
      [2, "success"],
    ] as const) {
      raised.length = 0;
      answerWith(() => Promise.resolve(ANSICHT));
      const { user, unmount } = renderPanel();

      await pressTwice(user, {
        resting: RESTING,
        armed: ARMED,
        whileArmed: async () => {
          await settle();
          // Swapped once the arming read has landed: one answer stands for every export the double replaces.
          answerWith(() => Promise.resolve({ success: true, cleared: cleared, message: "" }));
        },
      });
      await settle();

      assert.equal(toastsOf(variant), 1, `a write clearing ${String(cleared)} is reported as something else`);
      unmount();
    }
  });
});
