import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { nextRouter, underNext } from "@/shared/testing/nextContexts.ts";

/* Every write hangs until a case answers it: a real action needs a session and a backend. */
const { answerWith, answered } = doubleActions({
  modules: ["/src/features/kontakte/actions.ts"],
  answer: () => new Promise<never>(() => undefined),
});

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { FormKontaktEinladen } = await import("./FormKontaktEinladen.tsx");

const control = () =>
  underNext(h(FormKontaktEinladen, { teamId: "t1", saisonId: "2627", rolle: "ansprechperson", label: "Ansprechperson", isDirty: false }), {
    router: nextRouter(),
  });

afterEach(() => {
  toasts.length = 0;
  answerWith(() => new Promise<never>(() => undefined));
});

describe("the contact seat's link control", () => {
  /* A rejection says nothing of whether the link left, and a second send replaces it either way, so
     the control's own repair invites the press again rather than the generic reload. */
  it("says a send whose action rejected is unclear, and that sending again is safe", async () => {
    answerWith(() => Promise.reject(new TypeError("Failed to fetch")));
    render(control());

    await userEvent.setup().click(screen.getByRole("button", { name: "Bestätigungslink senden: Ansprechperson" }));
    await act(answered);

    await waitFor(() =>
      assert.deepEqual(
        toasts.map((raised) => [raised.title, raised.description, raised.options?.outcome]),
        [
          [
            "Unklar, ob der Link verschickt wurde",
            "Prüfe die Verbindung, lade die Seite neu und sende den Link erneut. Ein neuer Link ersetzt einen, der schon rausging.",
            "unknown",
          ],
        ],
      ),
    );
  });
});
