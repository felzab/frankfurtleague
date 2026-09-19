import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it, mock } from "node:test";

import { createElement as h } from "react";
/* `useRouter` reads a context no `next/navigation` export carries, so the panel renders under the one
   Next keeps it on. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { closedControl, isInTheFlow } from "@/shared/testing/closedControl.ts";

import type { ContextType } from "react";

const patchSaisonTeamKontakteAction = mock.fn(() => new Promise(() => undefined));
Reflect.set(globalThis, "__flKontakteLoeschen", { patchSaisonTeamKontakteAction });

// The slice's actions replaced at the module boundary by the mock above: a real write needs a session and a backend.
registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/features/kontakte/actions.ts"))
      return {
        format: "module",
        source: "export const { patchSaisonTeamKontakteAction } = globalThis.__flKontakteLoeschen;",
        shortCircuit: true,
      };
    return nextLoad(url, context);
  },
});

const { FormKontakteLoeschenSection } = await import("./FormKontakteLoeschenSection.tsx");

/** Every method the panel reaches only after a write, which no case here lets answer. */
const ROUTER: NonNullable<ContextType<typeof AppRouterContext>> = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "kontakteLoeschen",
};

function renderPanel(hasStored: boolean) {
  const user = userEvent.setup({ delay: null });
  const view = render(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
      h(FormKontakteLoeschenSection, { teamId: "t1", saisonId: "2526", hasStored: hasStored, stand: "9f2c", isDirty: false }),
    ),
  );

  return { user, ...view };
}

describe("the season's contact block, cleared from its own section", () => {
  /* The write is irreversible and reaches every seat of the season, so the first press says what it
     takes rather than taking it. */
  it("says what it would clear on the first press, and clears nothing", async () => {
    const { user } = renderPanel(true);

    await user.click(screen.getByRole("button", { name: "Kontakte löschen" }));

    assert.ok(screen.queryByText("Was dabei geleert wird"), "the armed press names nothing it would clear");
    assert.ok(screen.queryByRole("button", { name: "Ja, Kontakte dieser Saison endgültig löschen" }), "the first press offers no second one");
    assert.equal(patchSaisonTeamKontakteAction.mock.callCount(), 0, "the first press cleared the season's block");
  });

  /* Closed on the control and said in the body alike: clearing three empty seats takes no person, and a
     press that refuses itself is one an administrator is left guessing about. */
  it("closes over a season holding nobody, with the reason the body gives", () => {
    renderPanel(false);
    const gesagt = "Für diese Saison sind keine Kontakte gespeichert.";

    closedControl("Kontakte löschen", gesagt);
    assert.ok(isInTheFlow(gesagt), "the closed control says more than the body it stands under");
  });
});
