import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

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

  /* The markup a browser holds before hydration, when no handler catches an Enter: its own submit
     then goes out by this method, and a GET puts every field in the URL (`docs/frontend/spec.md :: I461`). */
  it("posts its fields in the server-rendered markup, never in a URL", () => {
    const markup = renderToStaticMarkup(h(Form, { onSubmit: () => undefined, wiring: formWiring() }, h("input", { name: "email" })));
    const opening = /<form\b[^>]*>/.exec(markup)?.[0] ?? "";

    assert.match(opening, /\bmethod="post"/, `the form a browser submits before hydration sends a GET: ${opening}`);
  });

  /* An Enter submits through the form's default button, its first submit button; disabled, the browser
     ignores the Enter, and the page's own handler takes over once it runs (`docs/frontend/spec.md :: I461`). */
  it("renders a disabled default button before hydration, and none once the page runs", () => {
    const tree = h(Form, { onSubmit: () => undefined, wiring: formWiring() }, h("button", { type: "submit" }, "Senden"));
    const markup = renderToStaticMarkup(tree);
    const firstSubmit = /<button\b[^>]*type="submit"[^>]*>/.exec(markup)?.[0] ?? "";
    assert.match(firstSubmit, /\bdisabled=""/, `the form's default button before hydration is live: ${firstSubmit}`);

    const { container } = render(tree);
    const submits = container.querySelectorAll('button[type="submit"]');
    assert.equal(submits.length, 1, "the disabled default button outlived hydration");
    assert.equal(submits[0]?.hasAttribute("disabled"), false);
  });
});

/* Held by tsc as the `action` refusal below is: a form taking `method` again could hand a GET back. */
// @ts-expect-error -- the refusal under test: the shared form fixes its own method.
void h(Form, { onSubmit: () => undefined, wiring: formWiring(), method: "get" });

/* Held by tsc rather than the runner, which strips types: a form taking `action` again leaves this
   directive unused, and the typecheck fails on it (`docs/frontend/spec.md :: I32`). */
// @ts-expect-error -- the refusal under test: the shared form declares no `action`.
void h(Form, { onSubmit: () => undefined, wiring: formWiring(), action: () => undefined });
