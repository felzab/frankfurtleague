import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";

import type { FormState } from "@/shared/types/types.ts";

const { raised } = doubleToasts();

/* `await import`, never a static import beside the double: the hook reaches the toast module, and a
   static import would have resolved the real one before the double registered. */
const { useSignOut } = await import("./useSignOut.ts");

function Probe({ onSignOut }: { onSignOut: () => Promise<FormState> }): ReturnType<typeof h> {
  const { isConfirming, isSigningOut, press } = useSignOut(onSignOut);

  // Marked as the control, or the hook's outside-press disarm takes the confirming press for a press elsewhere.
  return h(
    "button",
    { type: "button", onClick: press, "data-signout-control": "true" },
    isSigningOut ? "Meldet ab..." : isConfirming ? "Wirklich abmelden" : "Abmelden",
  );
}

/** The arming press and the one that signs out, up to the toast answering it. */
async function signOut(onSignOut: () => Promise<FormState>) {
  const user = userEvent.setup();
  const { router, seen } = recordingRouter();
  render(underNext(h(Probe, { onSignOut }), { router }));

  await pressTwice(user, { resting: "Abmelden", armed: "Wirklich abmelden" });
  await waitFor(() => assert.equal(raised.length, 1));

  return seen;
}

beforeEach(() => {
  raised.length = 0;
});

describe("what a sign-out tells the reader", () => {
  /* The edge cutting the request rejects the action after the session may have ended, so neither
     „Abgemeldet“ nor „Nicht abgemeldet“ is true: only a reload tells. */
  it("says nobody can tell whether a cut sign-out ended the session, and goes nowhere", async () => {
    const seen = await signOut(() => Promise.reject(new Error("An unexpected response was received from the server.")));

    assert.deepEqual(
      raised.map(({ variant, title, description }) => ({ variant, title, description })),
      [{ variant: "danger", title: "Abmeldung unklar", description: "Lade die Seite neu, um zu sehen, ob Du noch angemeldet bist." }],
    );
    assert.deepEqual(seen.pushed, [], "a sign-out nobody can vouch for left the page");
  });

  it("names a refusal under the negated title", async () => {
    const seen = await signOut(async () => ({ success: false, error: "Versuche es erneut." }));

    assert.deepEqual(
      raised.map(({ variant, title, description }) => ({ variant, title, description })),
      [{ variant: "danger", title: "Nicht abgemeldet", description: "Versuche es erneut." }],
    );
    assert.deepEqual(seen.pushed, []);
  });

  /* One motor action rather than two read decisions: the second click lands on the armed control before
     anybody could have read it. */
  it("arms on a double-click and ends no session", async () => {
    const user = userEvent.setup();
    let asked = 0;
    render(
      underNext(
        h(Probe, {
          onSignOut: async (): Promise<FormState> => {
            asked += 1;
            return { success: true, message: "Abgemeldet" };
          },
        }),
        { router: recordingRouter().router },
      ),
    );

    await user.dblClick(screen.getByRole("button", { name: "Abmelden" }));

    assert.equal(asked, 0, "a double-click ended the session unread");
    assert.ok(screen.getByRole("button", { name: "Wirklich abmelden" }));
  });

  it("leaves for the start page once the session has ended", async () => {
    const seen = await signOut(async () => ({ success: true, message: "Abgemeldet" }));

    assert.deepEqual(
      raised.map(({ variant, title }) => ({ variant, title })),
      [{ variant: "success", title: "Abgemeldet" }],
    );
    assert.deepEqual(seen.pushed, ["/"]);
  });
});
