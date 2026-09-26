import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { fireEvent, render } from "@testing-library/react";

import { formWiring } from "@/shared/testing/formWiring.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { Form } = await import("./Form.tsx");

describe("the shared form", () => {
  /* The browser's own submit reloads the page and takes the draft with it, so every form's submit is
     the handler alone (`docs/frontend/spec.md :: I32`). */
  it("keeps the browser's own submit and runs the handler once", () => {
    let ran = 0;
    const { container } = render(
      h(Form, { onSubmit: () => void (ran += 1), wiring: formWiring() }, h("button", { type: "submit" }, "Speichern")),
    );
    const form = container.querySelector("form");
    assert.ok(form !== null, "the shared form renders no form element");

    assert.equal(fireEvent.submit(form), false, "the browser's own submit went ahead");
    assert.equal(ran, 1, "the handler did not run exactly once");
  });
});

/* Held by tsc rather than the runner, which strips types: a form taking `action` again leaves this
   directive unused, and the typecheck fails on it (`docs/frontend/spec.md :: I32`). */
// @ts-expect-error -- the refusal under test: the shared form declares no `action`.
void h(Form, { onSubmit: () => undefined, wiring: formWiring(), action: () => undefined });
