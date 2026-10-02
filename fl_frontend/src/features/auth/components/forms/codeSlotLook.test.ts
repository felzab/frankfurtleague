import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { Input } from "@heroui/react/input";

import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { compiledGlobals, selectorsOf } from "@/shared/testing/stylesheet.ts";

import type { Rule } from "postcss";

const fetchMock = doubleFetch();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { CodeStep } = await import("./CodeStep.tsx");
const { TextField } = await import("@/shared/components/ui/TextField.tsx");

const compiled = await compiledGlobals();

/** The properties a field's resting, focused and refused looks are drawn with. */
const LOOK = ["border-color", "--tw-inset-ring-shadow", "--tw-ring-shadow", "--tw-ring-offset-shadow", "outline", "outline-offset"] as const;

/** Unlayered and outside any media query, so it reaches every element its selector matches. */
const isPlain = (rule: Rule): boolean => {
  for (let node = rule.parent; node != null; node = node.parent) {
    if (node.type === "atrule") return false;
  }
  return true;
};

// A selector jsdom's engine cannot read matches nothing, so each case asserts the look it compares was found.
const matches = (element: Element, selector: string): boolean => {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
};

/**
 * What the app's own unlayered rules declare on an element, later rules over earlier, with a field's accent
 * variable resolved: the look HeroUI's layered rules cannot outrank.
 */
function lookOf(element: Element): Record<string, string> {
  const declared = new Map<string, string>();
  compiled.walkRules((rule) => {
    if (!isPlain(rule) || !selectorsOf(rule).some((selector) => matches(element, selector))) return;
    for (const node of rule.nodes) if (node.type === "decl") declared.set(node.prop, node.value);
  });

  const accent = declared.get("--field-focus-accent") ?? "";
  return Object.fromEntries(LOOK.map((prop) => [prop, (declared.get(prop) ?? "").replaceAll("var(--field-focus-accent)", accent)]));
}

/** A focused text field, as HeroUI renders one. */
async function fieldLook(state: { isInvalid?: boolean; isReadOnly?: boolean }): Promise<Record<string, string>> {
  const { unmount } = render(h(TextField, { "aria-label": "Feld", ...state }, h(Input)));
  const input = screen.getByRole("textbox", { name: "Feld" });
  await act(async () => input.focus());
  const look = lookOf(input);
  act(() => unmount());
  return look;
}

const answered = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const STEP = {
  address: "vorstand@example.org",
  message: null,
  hint: "Ein Hinweis.",
  submitLabel: { rest: "Weiter", pending: "Läuft..." },
  isSending: false,
  onResend: () => undefined,
  onSignedIn: () => undefined,
};

const activeSlot = (): Element =>
  document.querySelector('[data-slot="input-otp-slot"][data-active="true"]') ?? assert.fail("no code slot is marked active");

describe("a code slot's look beside a text field's", () => {
  it("takes the text field's focus look while the caret stands in it", async () => {
    render(h(CodeStep, STEP));
    const slot = lookOf(activeSlot());
    const field = await fieldLook({});

    assert.match(field["border-color"] ?? "", /accent-brand/, "the text field's focus look was not found, so nothing is compared");
    assert.deepEqual(slot, field);
  });

  it("takes the text field's refused and focused look once its code is refused", async () => {
    const user = userEvent.setup();
    render(h(CodeStep, STEP));
    fetchMock.mock.mockImplementationOnce(() => Promise.resolve(answered({ success: false, error: "Der Code stimmt nicht." })));
    await user.type(screen.getByLabelText("Code aus der E-Mail"), "000000");
    await screen.findByRole("alert");

    const slot = lookOf(activeSlot());
    const field = await fieldLook({ isInvalid: true });

    assert.match(field["border-color"] ?? "", /accent-danger/, "the text field's refused look was not found, so nothing is compared");
    assert.deepEqual(slot, field);
  });

  /* Read-only while the check runs, so it drops the focus border as a frozen text field does. */
  it("takes a frozen text field's look while its check runs", async () => {
    const user = userEvent.setup();
    render(h(CodeStep, STEP));
    fetchMock.mock.mockImplementationOnce(() => new Promise<Response>(() => undefined));
    await user.type(screen.getByLabelText("Code aus der E-Mail"), "000000");
    await screen.findByRole("button", { name: STEP.submitLabel.pending });

    // jsdom fires no `selectionchange`, so the slot a browser marks as the caret's after the sixth digit is marked here.
    const slots = document.querySelectorAll('[data-slot="input-otp-slot"]');
    slots[slots.length - 1]?.setAttribute("data-active", "true");
    const slot = lookOf(activeSlot());
    const field = await fieldLook({ isReadOnly: true });

    assert.equal(slot["border-color"], "", "the slot keeps its focus border while its code is checked");
    assert.deepEqual(slot, field);
  });
});
