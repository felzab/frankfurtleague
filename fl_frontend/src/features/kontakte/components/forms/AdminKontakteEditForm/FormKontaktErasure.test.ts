import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it, mock } from "node:test";

import { act, createElement as h } from "react";
/* `useRouter` reads a context no `next/navigation` export carries, so the panel renders under the one
   Next keeps it on. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { DOUBLE_PRESS_MS } from "@/shared/hooks/useTwoPressConfirm.ts";
import { closedControl } from "@/shared/testing/closedControl.ts";

import type { ContextType } from "react";

const readKontaktErasureAnsichtAction = mock.fn<() => Promise<unknown>>();
const eraseKontaktpersonAction = mock.fn<() => Promise<unknown>>(() => new Promise(() => undefined));
const appToast = { success: mock.fn(), warning: mock.fn(), danger: mock.fn(), info: mock.fn() };
Reflect.set(globalThis, "__flErasure", { readKontaktErasureAnsichtAction, eraseKontaktpersonAction, appToast });

/* The panel's two actions and its toasts, replaced at the module boundary by the mocks above: a real
   action needs a session and a backend, and the real toast module raises into HeroUI's queue. */
registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/features/kontakte/actions.ts"))
      return {
        format: "module",
        source: "export const { readKontaktErasureAnsichtAction, eraseKontaktpersonAction } = globalThis.__flErasure;",
        shortCircuit: true,
      };
    if (url.endsWith("/src/shared/utils/appToast.ts"))
      return { format: "module", source: "export const { appToast } = globalThis.__flErasure;", shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { FormKontaktErasure } = await import("./FormKontaktErasure.tsx");

/** Every method the panel reaches only after a write, which these cases never let answer. */
const ROUTER: NonNullable<ContextType<typeof AppRouterContext>> = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "kontaktErasure",
};

/** The read no connection answered, as the panel words it. */
const OHNE_VERBINDUNG =
  "Die Übersicht, wer dabei gelöscht wird, konnte nicht geladen werden, und ohne sie wird nichts gelöscht. " +
  "Prüfe die Verbindung. Brich ab und starte das Löschen noch einmal.";

/** The read's answer arriving, and everything it sets off. */
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** The panel, armed: its first press starts the read the second press is confirmed over. */
async function armedPanel() {
  const user = userEvent.setup({ delay: null });
  const view = render(
    h(AppRouterContext.Provider, { value: ROUTER }, h(FormKontaktErasure, { email: "ada@example.org", fullName: "Ada Byron", isDirty: false })),
  );

  await user.click(screen.getByRole("button", { name: "Kontaktperson löschen" }));

  return { user, container: view.container, unmount: view.unmount };
}

describe("the person's erasure over its arming read", () => {
  /* The names ARE the confirmation, so a refused read closes the press; closed without a reason, a reader
     meets a dead button and nothing on it says the list is what is missing (`docs/frontend/spec.md` §1.14). */
  it("says on the closed press what the reveal says, and how to read the list again", async () => {
    readKontaktErasureAnsichtAction.mock.mockImplementationOnce(() => Promise.reject(new TypeError("Failed to fetch")));
    await armedPanel();
    await settle();

    closedControl("Ja, Kontaktperson endgültig löschen", OHNE_VERBINDUNG);
    assert.ok(
      screen.queryAllByText(OHNE_VERBINDUNG).some((satz) => satz.closest("[hidden]") === null),
      "the armed reveal says less than the closed press",
    );
  });

  /* A read still running ends by itself, as a running write does, so it names no reason; the press is held
     rather than closed, keeping the focus the arming press left on it, and erases nothing until the names stand. */
  it("holds the press while the read runs, and erases once the names are on screen", async (t) => {
    let beantworte: (antwort: unknown) => void = () => undefined;
    readKontaktErasureAnsichtAction.mock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          beantworte = resolve;
        }),
    );
    // Past the double-press window, so the press below is refused by the hold and never by its timing.
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const { user } = await armedPanel();
    const bestaetigen = screen.getByRole("button", { name: "Ja, Kontaktperson endgültig löschen" });
    t.mock.timers.tick(DOUBLE_PRESS_MS);

    await user.click(bestaetigen);
    assert.equal(eraseKontaktpersonAction.mock.callCount(), 0, "the press erased over the placeholder");
    assert.equal(bestaetigen.hasAttribute("disabled"), false, "the running read closes the press, dropping the focus on it");
    assert.equal(bestaetigen.getAttribute("data-pending"), "true", "a read still running closes the press rather than holding it");
    assert.equal(
      screen.queryAllByRole("button", { name: /Kontaktperson endgültig löschen/, description: /./ }).length,
      0,
      "a read still running names a reason",
    );

    await act(async () => {
      beantworte({ success: true, ansicht: { acknowledged: 1, saison_teams: [], bewerbungen: [] } });
    });
    await user.click(bestaetigen);

    assert.equal(eraseKontaktpersonAction.mock.callCount(), 1, "the press stays held over the names it is confirmed over");
  });
});

describe("what an erasure reports once it has run", () => {
  /* The endpoint refuses nothing, so an address matching nobody succeeds and clears zero: reported as
     „gelöscht“, that is a deletion nobody made. */
  it("calls a write that found nobody a miss, and one that cleared somebody a deletion", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    readKontaktErasureAnsichtAction.mock.mockImplementation(() =>
      Promise.resolve({ success: true, ansicht: { acknowledged: 1, saison_teams: [], bewerbungen: [] } }),
    );

    for (const [cleared, gemeldet] of [
      [0, appToast.warning],
      [2, appToast.success],
    ] as const) {
      appToast.warning.mock.resetCalls();
      appToast.success.mock.resetCalls();
      eraseKontaktpersonAction.mock.mockImplementationOnce(() => Promise.resolve({ success: true, cleared: cleared, message: "" }));
      const { user, unmount } = await armedPanel();
      t.mock.timers.tick(DOUBLE_PRESS_MS);

      await settle();
      await user.click(screen.getByRole("button", { name: "Ja, Kontaktperson endgültig löschen" }));
      await settle();

      assert.equal(gemeldet.mock.callCount(), 1, `a write clearing ${String(cleared)} is reported as something else`);
      unmount();
    }
  });
});
