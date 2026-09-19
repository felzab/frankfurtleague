import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions } from "@/shared/testing/actionDoubles.ts";
import { closedControl, isInTheFlow } from "@/shared/testing/closedControl.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

/** The slice's writes, replaced at the module boundary: a real one needs a session and a backend. */
const { calls } = doubleActions({ modules: ["/src/features/kontakte/actions.ts"], answer: () => new Promise(() => undefined) });

const { FormKontakteLoeschenSection } = await import("./FormKontakteLoeschenSection.tsx");

function renderPanel(hasStored: boolean) {
  const user = userEvent.setup({ delay: null });
  const view = render(
    underNext(h(FormKontakteLoeschenSection, { teamId: "t1", saisonId: "2526", hasStored: hasStored, stand: "9f2c", isDirty: false })),
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
    assert.equal(calls.length, 0, "the first press cleared the season's block");
  });

  /* Closed on the control and said in the body alike: clearing three empty seats takes no person, and a
     press that refuses itself is one an administrator is left guessing about. */
  it("closes over a season holding nobody, with the reason the body gives", () => {
    renderPanel(false);
    const said = "Für diese Saison sind keine Kontakte gespeichert.";

    closedControl("Kontakte löschen", said);
    assert.ok(isInTheFlow(said), "the closed control says more than the body it stands under");
  });
});
