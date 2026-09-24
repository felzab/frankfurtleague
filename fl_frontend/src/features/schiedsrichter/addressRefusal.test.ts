import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";

import { bodyField, refusedPayload } from "@/shared/testing/refusedPayload.ts";
import { FELD_ABGELEHNT, toActionErrorResult } from "@/shared/utils/actionError.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { Form } = await import("@/shared/components/ui/Form.tsx");
const { SchiedsrichterFormFields } = await import("./components/forms/SchiedsrichterFormFields.tsx");

const ENTWURF = { name: "Anna Meier", schule: "", default_payment: 20, kontakt: { email: "anna@beispiel.test", telefon: "" } };

describe("an address only the API refuses", () => {
  /* The whole route a 422 takes to the box, the render included: the map keyed as the backend names
     the path is handed to `Form`, which marks only a control whose `name` spells that key. */
  it("is marked on the address box the create form renders, and on no other", () => {
    const result = toActionErrorResult(refusedPayload([bodyField(["kontakt", "email"])], "/schiedsrichter"));

    render(h(Form, { validationErrors: result.fieldErrors }, h(SchiedsrichterFormFields, { draft: ENTWURF, onChange: () => undefined })));

    const box = screen.getByRole("textbox", { name: "E-Mail" });
    assert.equal(box.getAttribute("aria-invalid"), "true", "the address box is not marked");
    assert.equal(screen.getAllByText(FELD_ABGELEHNT).length, 1, "the message is not rendered exactly once");
    assert.match(box.getAttribute("aria-describedby") ?? "", /\S/, "the message is not tied to the address box");
    assert.equal(screen.getByRole("textbox", { name: "Name" }).getAttribute("aria-invalid"), null, "a box the refusal never named is marked");
  });
});
