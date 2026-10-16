import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { answersInFlight } from "@/shared/testing/answersInFlight.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";

import type { SignOutResult } from "@/shared/types/types.ts";

const { raised } = doubleToasts();

/** Every path the sign-out left the document for. */
const left: string[] = [];

/* A full document load, which jsdom does not implement and whose `location` no test can replace:
   recorded at the module boundary. */
registerDoubles({ modules: { "shared/utils/documentNavigation.ts": { leaveDocumentFor: (path: string) => void left.push(path) } } });

/* `await import`, never a static import beside the double: the hook reaches the toast module, and a
   static import would have resolved the real one before the double registered. */
const { useSignOut } = await import("./useSignOut.ts");

function Probe({ onSignOut }: { onSignOut: () => Promise<SignOutResult> }): ReturnType<typeof h> {
  const { confirm, press } = useSignOut(onSignOut);

  // Marked as the control, or the hook's outside-press disarm takes the confirming press for a press elsewhere.
  return h(
    "button",
    { type: "button", onClick: press, "data-signout-control": "true" },
    confirm.isPending ? "Meldet ab..." : confirm.isConfirming ? "Wirklich abmelden" : "Abmelden",
  );
}

/** The sign-out's answers, awaited before what answers them is polled for. */
const answers = answersInFlight();

/** The arming press and the one that signs out, up to the action's answer. */
async function signOut(onSignOut: () => Promise<SignOutResult>) {
  const user = userEvent.setup();
  const { router, seen } = recordingRouter();
  render(underNext(h(Probe, { onSignOut: () => answers.track("signOut", onSignOut()) }), { router }));

  await pressTwice(user, { resting: "Abmelden", armed: "Wirklich abmelden" });
  await act(answers.answered);

  return seen;
}

beforeEach(() => {
  raised.length = 0;
  left.length = 0;
});

describe("what a sign-out tells the reader", () => {
  /* The edge cutting the request rejects the action after the session may have ended, so neither
     „Abgemeldet“ nor „Nicht abgemeldet“ is true: only a reload tells. */
  it("says nobody can tell whether a cut sign-out ended the session, and goes nowhere", async () => {
    const seen = await signOut(() => Promise.reject(new Error("An unexpected response was received from the server.")));

    await waitFor(() => assert.equal(raised.length, 1));
    assert.deepEqual(
      raised.map(({ variant, title, description }) => ({ variant, title, description })),
      [{ variant: "danger", title: "Abmeldung unklar", description: "Lade die Seite neu, um zu sehen, ob Du noch angemeldet bist." }],
    );
    assert.deepEqual(left, [], "a sign-out nobody can vouch for left the page");
    assert.deepEqual(seen.pushed, []);
  });

  it("names a refusal under the negated title", async () => {
    const seen = await signOut(async () => ({ success: false, error: "Versuche es erneut." }));

    await waitFor(() => assert.equal(raised.length, 1));
    assert.deepEqual(
      raised.map(({ variant, title, description }) => ({ variant, title, description })),
      [{ variant: "danger", title: "Nicht abgemeldet", description: "Versuche es erneut." }],
    );
    assert.deepEqual(left, []);
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
          onSignOut: async (): Promise<SignOutResult> => {
            asked += 1;
            return { success: true };
          },
        }),
        { router: recordingRouter().router },
      ),
    );

    await user.dblClick(screen.getByRole("button", { name: "Abmelden" }));

    assert.equal(asked, 0, "a double-click ended the session unread");
    assert.ok(screen.getByRole("button", { name: "Wirklich abmelden" }));
  });

  /* A whole new document, never the router: a soft navigation keeps every route it hid, with the
     rows and the typed searches of the session just ended. A toast would vanish with the page it
     was raised on, unread. */
  it("loads the start page as a new document once the session has ended, and raises no toast", async () => {
    const seen = await signOut(async () => ({ success: true }));

    await waitFor(() => assert.deepEqual(left, ["/"]));
    assert.deepEqual(raised, [], "a sign-out that leaves the page raised a toast over it");
    assert.deepEqual({ pushed: seen.pushed, replaced: seen.replaced, refresh: seen.refresh }, { pushed: [], replaced: [], refresh: 0 });
  });
});
