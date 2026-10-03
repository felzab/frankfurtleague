import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { Input } from "@heroui/react/input";

import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { compiledGlobals, selectorsOf } from "@/shared/testing/stylesheet.ts";

import type { Container, Document, Rule } from "postcss";

const fetchMock = doubleFetch();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { CodeStep } = await import("./CodeStep.tsx");
const { TextField } = await import("@/shared/components/ui/TextField.tsx");

const compiled = await compiledGlobals();

/** The properties a field's resting, focused and refused looks are drawn with. */
const LOOK = ["border-color", "--tw-inset-ring-shadow", "--tw-ring-shadow", "--tw-ring-offset-shadow", "outline", "outline-offset"] as const;

/** Unlayered and outside any media query, so it reaches every element its selector matches. */
const isPlain = (rule: Rule): boolean => {
  for (let node: Container | Document | undefined = rule.parent; node != null; node = node.parent) {
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
  // HeroUI clears the outline of its input and of a code slot alike in `@layer components`, so no app rule is none.
  declared.set("outline", declared.get("outline") ?? "none");
  return Object.fromEntries(LOOK.map((prop) => [prop, (declared.get(prop) ?? "").replaceAll("var(--field-focus-accent)", accent)]));
}

/** A focused text field, as HeroUI renders one. */
async function fieldLook(state: { isInvalid?: boolean }): Promise<Record<string, string>> {
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

  /* Read-only while the check runs, so it drops the focus border as a frozen text field does; typed after a click, as
     a field reached by a click. */
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
    cleanup();
    const field = await frozenFieldLook(user, "pointer");

    assert.equal(slot["border-color"], "", "the slot keeps its focus border while its code is checked");
    assert.deepEqual(slot, field);
  });
});

type User = ReturnType<typeof userEvent.setup>;

/** A frozen text field reached the way the reader reached the code: by the keyboard, or by a click. */
async function frozenFieldLook(user: User, by: "keyboard" | "pointer"): Promise<Record<string, string>> {
  const { unmount } = render(h(TextField, { "aria-label": "Feld", isReadOnly: true }, h(Input)));
  const input = screen.getByRole("textbox", { name: "Feld" });
  if (by === "keyboard") await user.tab();
  else await user.click(input);
  const look = lookOf(input);
  act(() => unmount());
  return look;
}

/**
 * The code entered and held at its check, the caret having reached the field by the keyboard or by a click, once
 * react-aria has marked it as its own text input would and input-otp has still marked its caret's slot.
 */
async function frozenCode(user: User, by: "keyboard" | "pointer"): Promise<void> {
  render(h(CodeStep, STEP));
  const field = screen.getByLabelText<HTMLInputElement>("Code aus der E-Mail");
  act(() => field.blur());
  fetchMock.mock.mockImplementationOnce(() => new Promise<Response>(() => undefined));

  if (by === "keyboard") {
    await user.tab();
    assert.ok(document.activeElement === field, "the first Tab does not reach the code");
    assert.equal(field.getAttribute("data-focus-visible"), "true", "the keyboard's focus is not marked on the code");
    // input-otp's own focus handler, which ours must not replace.
    activeSlot();
    await user.keyboard("000000");
  } else {
    await user.click(field);
    assert.equal(field.getAttribute("data-focus-visible"), null, "a click's focus is marked as the keyboard's");
    activeSlot();
    await user.paste("000000");
  }
  await screen.findByRole("button", { name: STEP.submitLabel.pending });

  // jsdom fires no `selectionchange`, so the slot a browser marks as the caret's after the sixth digit is marked here.
  const slots = document.querySelectorAll('[data-slot="input-otp-slot"]');
  slots[slots.length - 1]?.setAttribute("data-active", "true");
}

describe("a code slot's look while its check runs, by how the code came in", () => {
  /* A frozen text field draws its outline only for keyboard focus, react-aria's modality rather than the browser's. */
  it("draws the frozen field's outline after the keyboard", async () => {
    const user = userEvent.setup();
    await frozenCode(user, "keyboard");
    const slot = lookOf(activeSlot());
    cleanup();
    const field = await frozenFieldLook(user, "keyboard");

    assert.match(field.outline ?? "", /2px solid/, "the frozen text field's keyboard outline was not found, so nothing is compared");
    assert.deepEqual(slot, field);
  });

  it("draws no outline after a click and a paste, as a frozen field reached by a click shows none", async () => {
    const user = userEvent.setup();
    await frozenCode(user, "pointer");
    const slot = lookOf(activeSlot());
    cleanup();
    const field = await frozenFieldLook(user, "pointer");

    assert.equal(slot.outline, "none", "the slot draws an outline after a click and a paste");
    assert.deepEqual(slot, field);
  });
});
