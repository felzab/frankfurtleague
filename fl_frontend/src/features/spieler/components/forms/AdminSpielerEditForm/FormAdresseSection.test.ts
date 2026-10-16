import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { act, createElement as h, useState } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { nextRouter, underNext } from "@/shared/testing/nextContexts.ts";

/* Every write hangs until a case answers it: a real action needs a session and a backend. */
const { answerWith, answered } = doubleActions({
  modules: ["/src/features/spieler/actions.ts"],
  answer: () => new Promise<never>(() => undefined),
});

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { FormAdresseSection } = await import("./FormAdresseSection.tsx");

/** A pupil's stored address with the request's box open over a new one, its typing held as the editor holds it. */
function Host() {
  const [entwurf, setEntwurf] = useState<string | null>("lena@neu.example");
  return h(FormAdresseSection, {
    spielerId: "6890a1b2c3d4e5f607800002",
    email: "lena@schule.example",
    isDirty: false,
    entwurf,
    onEntwurfChange: setEntwurf,
  });
}

afterEach(() => {
  toasts.length = 0;
});

describe("what the address request says of the link it sent", () => {
  /* The request stands whichever way its link went, so a link that failed or that the ban list held
     back is a warning titled for what happened, never a sent link. */
  for (const [versand, variant, title] of [
    ["gesendet", "success", "Link gesendet"],
    ["fehlgeschlagen", "warning", "Link nicht verschickt"],
    ["gesperrt", "warning", "Link zurückgehalten"],
  ] as const) {
    it(`titles a request whose link is ${versand} „${title}“`, async () => {
      answerWith(() => Promise.resolve({ success: true, message: "Der Link zur neuen Adresse.", versand: versand }));
      const { unmount } = render(underNext(h(Host), { router: nextRouter() }));

      await userEvent.setup().click(screen.getByRole("button", { name: "Link an neue Adresse senden" }));
      await act(answered);

      await waitFor(() =>
        assert.deepEqual(
          toasts.map((raised) => [raised.variant, raised.title]),
          [[variant, title]],
        ),
      );
      unmount();
    });
  }
});
