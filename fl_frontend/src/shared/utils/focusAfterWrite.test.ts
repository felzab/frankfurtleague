import "@/shared/testing/dom.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { FOCUS_HEADING, focusAfterWrite, focusRow, focusSection, focusSlot } from "./focusAfterWrite.ts";

/** One element, its attributes spread as the components spread them. */
function el(tag: string, attributes: Record<string, string | number> = {}, ...children: (Node | string)[]): HTMLElement {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name === "tabIndex" ? "tabindex" : name, String(value));
  element.append(...children);
  return element;
}

/** A control the press can rest on, named as a reader hears it. */
const button = (name: string, slot = "loeschen"): HTMLElement => el("button", { ...focusSlot(slot), type: "button" }, name);

/** A section holding a heading and one row per key, each row holding its delete control. */
function list(keys: readonly string[]): HTMLElement {
  return el(
    "section",
    focusSection("liste"),
    el("h2", FOCUS_HEADING, "Passkeys"),
    el("ul", {}, ...keys.map((key) => el("li", focusRow(key), button(`${key} löschen`)))),
  );
}

const focused = (): string => document.activeElement?.textContent ?? "";

/** Lets the observer's microtask run, as a commit's would. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const pressed = (name: string): HTMLElement => {
  const control = [...document.querySelectorAll("button")].find((each) => each.textContent === name);
  assert.ok(control, `no control „${name}“`);
  control.focus();
  return control;
};

afterEach(() => {
  // A landing a case armed and never resolved would otherwise move the next case's focus.
  document.dispatchEvent(new window.KeyboardEvent("keydown"));
  document.body.replaceChildren();
});

describe("where a landed write's focus goes", () => {
  it("drops to the page when the focused control is removed, which is what the landing answers", () => {
    document.body.append(list(["a"]));
    pressed("a löschen").remove();

    assert.ok(document.activeElement === document.body, `the focus moved to „${focused()}“`);
  });

  it("takes the control replacing the pressed one in its own row", async () => {
    document.body.append(list(["a", "b"]));
    const control = pressed("a löschen");
    const landing = focusAfterWrite();

    landing.landed();
    control.replaceWith(button("a reaktivieren"));
    await settle();

    assert.equal(focused(), "a reaktivieren");
  });

  it("takes the same control in the next row where the pressed row went", async () => {
    document.body.append(list(["a", "b", "c"]));
    const landing = focusAfterWrite(pressed("b löschen"));

    landing.landed();
    document.querySelector(`[data-focus-row="b"]`)?.remove();
    await settle();

    assert.equal(focused(), "c löschen");
  });

  it("takes the previous row's where the pressed row was the last, the nearest first", async () => {
    document.body.append(list(["a", "b", "c"]));
    const landing = focusAfterWrite(pressed("c löschen"));

    landing.landed();
    document.querySelector(`[data-focus-row="c"]`)?.remove();
    await settle();

    assert.equal(focused(), "b löschen");
  });

  /* A row holding no such control, as this device's own sign-in holds no sign-out, is passed over. */
  it("passes over a row that holds no such control", async () => {
    document.body.append(list(["a", "b", "c"]));
    document.querySelector(`[data-focus-row="b"] button`)?.remove();
    const landing = focusAfterWrite(pressed("a löschen"));

    landing.landed();
    document.querySelector(`[data-focus-row="a"]`)?.remove();
    await settle();

    assert.equal(focused(), "c löschen");
  });

  it("takes the section's heading where the list emptied", async () => {
    document.body.append(list(["a"]));
    const landing = focusAfterWrite(pressed("a löschen"));

    landing.landed();
    document.querySelector("ul")?.replaceChildren();
    await settle();

    assert.equal(focused(), "Passkeys");
  });

  it("finds the rows again by their keys after the whole section is drawn anew", async () => {
    document.body.append(list(["a", "b"]));
    const landing = focusAfterWrite(pressed("a löschen"));

    landing.landed();
    document.querySelector("section")?.replaceWith(list(["b"]));
    await settle();

    assert.equal(focused(), "b löschen");
  });

  it("takes the enclosing section's heading where its own section went", async () => {
    document.body.append(el("section", focusSection("aussen"), el("h2", FOCUS_HEADING, "Sicherheit"), list(["a"])));
    const landing = focusAfterWrite(pressed("a löschen"));

    landing.landed();
    document.querySelector(`[data-focus-section="liste"]`)?.remove();
    await settle();

    assert.equal(focused(), "Sicherheit");
  });

  it("takes the page's heading where no section around the control stands", async () => {
    document.body.append(el("h1", FOCUS_HEADING, "Sperrliste"), list(["a"]));
    document.querySelector("h2")?.remove();
    const landing = focusAfterWrite(pressed("a löschen"));

    landing.landed();
    document.querySelector("ul")?.replaceChildren();
    await settle();

    assert.equal(focused(), "Sperrliste");
  });

  /* `Hint`'s refusal leaves the control inert under an overlay standing beside it, which is the stop. */
  it("takes a closed control's overlay rather than the inert control", async () => {
    document.body.append(list(["a"]));
    const landing = focusAfterWrite(pressed("a löschen"));

    landing.landed();
    document
      .querySelector("li")
      ?.replaceChildren(
        el(
          "div",
          focusSlot("loeschen"),
          el("div", { inert: "" }, el("button", { type: "button", disabled: "" }, "a löschen")),
          el("div", { tabIndex: 0 }, "Grund"),
        ),
      );
    await settle();

    assert.equal(focused(), "Grund");
  });
});

describe("what a landing leaves alone", () => {
  it("moves nothing while the pressed control still stands", async () => {
    document.body.append(list(["a", "b"]));
    const landing = focusAfterWrite(pressed("a löschen"));

    landing.landed();
    document.body.append(el("p", {}, "Toast"));
    await settle();

    assert.equal(focused(), "a löschen");
  });

  /* A dialog confirming the write holds the focus while the row behind it is drawn anew. */
  it("waits while the page holds the focus elsewhere, and lands once it drops to the page", async () => {
    const dialog = el("div", { role: "dialog" }, el("button", { type: "button" }, "Ja, stilllegen"));
    document.body.append(list(["a"]), dialog);
    const landing = focusAfterWrite(pressed("a löschen"));
    pressed("Ja, stilllegen");

    landing.landed();
    document.querySelector("li button")?.replaceWith(button("a reaktivieren"));
    await settle();
    assert.equal(focused(), "Ja, stilllegen");

    dialog.remove();
    await settle();
    assert.equal(focused(), "a reaktivieren");
  });

  /* react-aria's grid focuses the cell once the control inside it goes, before the landing has run. */
  it("takes over a focus the page itself dropped inside the control's section", async () => {
    document.body.append(list(["a", "b"]));
    const landing = focusAfterWrite(pressed("a löschen"));

    landing.landed();
    const cell = document.querySelector<HTMLElement>(`[data-focus-row="a"]`);
    cell?.setAttribute("tabindex", "-1");
    cell?.replaceChildren(button("a reaktivieren"));
    cell?.focus();
    await settle();

    assert.ok(
      document.activeElement === cell?.querySelector("button"),
      `the focus stayed on <${document.activeElement?.tagName.toLowerCase() ?? "nothing"}>`,
    );
  });

  /* An editor's box closes on the answer, and the refresh keyed on the stored value then draws the page anew. */
  it("lands again where a later redraw takes the landed control away", async () => {
    document.body.append(list(["a", "b"]));
    const landing = focusAfterWrite(pressed("a löschen"));

    landing.landed();
    document.querySelector("li button")?.replaceWith(button("a reaktivieren"));
    await settle();
    document.querySelector("section")?.replaceWith(list(["a", "b"]));
    document.querySelector(`[data-focus-row="a"] button`)?.replaceWith(button("a reaktivieren"));
    await settle();

    assert.ok(
      document.activeElement === document.querySelector(`[data-focus-row="a"] button`),
      `the focus is on „${focused()}“ rather than the redrawn control`,
    );
  });

  it("lands at once where the control had already gone when the write answered", () => {
    document.body.append(list(["a", "b"]));
    const landing = focusAfterWrite(pressed("a löschen"));
    document.querySelector(`[data-focus-row="a"]`)?.remove();

    landing.landed();

    assert.equal(focused(), "b löschen");
  });

  it("stands down once the reader presses a key", async () => {
    document.body.append(list(["a", "b"]));
    const landing = focusAfterWrite(pressed("a löschen"));

    landing.landed();
    document.dispatchEvent(new window.KeyboardEvent("keydown"));
    document.querySelector(`[data-focus-row="a"]`)?.remove();
    await settle();

    assert.ok(document.activeElement === document.body, `the focus moved to „${focused()}“`);
  });

  it("moves nothing for a control no section holds", async () => {
    document.body.append(button("Allein"), list(["a"]));
    const control = pressed("Allein");

    focusAfterWrite().landed();
    control.remove();
    await settle();

    assert.ok(document.activeElement === document.body, `the focus moved to „${focused()}“`);
  });
});
