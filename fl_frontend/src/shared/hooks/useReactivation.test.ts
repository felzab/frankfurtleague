import "@/shared/testing/dom.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleToasts } from "@/shared/testing/actionDoubles.ts";

import type { ActionResult } from "@/shared/types/types.ts";

const { raised } = doubleToasts();

/* `await import`, never a static import beside the double: the hook below reaches the toast module,
   and a static import would have resolved the real one before the hook above registered. */
const { useReactivation } = await import("./useReactivation.ts");

function Probe({ answer }: { answer: () => Promise<ActionResult> }): ReturnType<typeof h> {
  const { reactivate } = useReactivation({ action: answer, noun: "Team" });

  return h("button", { type: "button", onClick: () => void reactivate({ id: "t1" }) }, "Reaktivieren");
}

const press = async (answer: () => Promise<ActionResult>): Promise<void> => {
  const user = userEvent.setup();
  render(h(Probe, { answer }));
  await user.click(screen.getByRole("button", { name: "Reaktivieren" }));
};

beforeEach(() => {
  raised.length = 0;
});

describe("what a reactivation tells the reader", () => {
  /* Every row-level reactivation answers with the words its title already carries, so a body taken
     from the answer unread would say the same thing twice under itself. */
  it("drops a body that repeats the title", async () => {
    await press(async () => ({ success: true, message: "Team reaktiviert" }));

    assert.deepEqual(
      raised.map(({ variant, title, description }) => ({ variant, title, description })),
      [{ variant: "success", title: "Team reaktiviert", description: undefined }],
    );
  });

  /* The squad row's write answers with a detail nothing else says — which fields came back — and a
     hook dropping every body would lose it. */
  it("carries a body the answer adds to the title", async () => {
    await press(async () => ({ success: true, message: "Nummer, Rolle, Position und Stufe sind wiederhergestellt." }));

    assert.deepEqual(raised[0]?.description, "Nummer, Rolle, Position und Stufe sind wiederhergestellt.");
  });

  it("names the refusal under the negated title", async () => {
    await press(async () => ({ success: false, error: "Das Team ist in dieser Saison nicht dabei." }));

    assert.deepEqual(
      raised.map(({ variant, title, description }) => ({ variant, title, description })),
      [{ variant: "danger", title: "Team nicht reaktiviert", description: "Das Team ist in dieser Saison nicht dabei." }],
    );
  });
});
