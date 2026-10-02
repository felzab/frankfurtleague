import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";

const ADDRESS = "spielerin@example.org";

/** The send, replaced at the module boundary: the real one needs a session store and a mail provider. */
doubleActions({
  modules: ["/src/features/auth/actions.ts"],
  answer: () =>
    Promise.resolve({
      success: true,
      message: "Falls zu dieser Adresse ein Konto gehört, ist ein Anmeldecode unterwegs.",
      submittedEmail: ADDRESS,
    }),
});
doubleToasts();
const fetchMock = doubleFetch();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { CodeConfirmation } = await import("./CodeConfirmation.tsx");

describe("the confirmation as the page opens", () => {
  /* The send's control is mounted with its ref at load, so only the refusal's flag keeps it from the focus. */
  it("leaves the focus where the page put it", () => {
    render(h(CodeConfirmation, { address: ADDRESS, istInhaber: () => Promise.resolve(true), onConfirmed: () => undefined }));

    // A boolean rather than the node: a failing comparison would inspect a jsdom node, which holds the whole window.
    const genommen = document.activeElement === screen.getByRole("button", { name: "Code per E-Mail senden" });
    assert.ok(!genommen, "the send's control took the focus as the page loaded");
  });
});

describe("a code that confirmed somebody other than the page's holder", () => {
  it("hands the focus to the control that sends the next code", async () => {
    const user = userEvent.setup();
    render(h(CodeConfirmation, { address: ADDRESS, istInhaber: () => Promise.resolve(false), onConfirmed: () => undefined }));

    await user.click(screen.getByRole("button", { name: "Code per E-Mail senden" }));
    const field = await screen.findByLabelText<HTMLInputElement>("Code aus der E-Mail");
    fetchMock.mock.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } })),
    );
    await user.type(field, "048213");
    await screen.findByRole("alert");

    // `ok` rather than `equal` on an element: a failure's report inspects both sides, and a jsdom node holds the whole window.
    assert.ok(
      document.activeElement === screen.getByRole("button", { name: "Code per E-Mail senden" }),
      "the refusal replaced the code field and the focus fell to the page",
    );
  });
});
