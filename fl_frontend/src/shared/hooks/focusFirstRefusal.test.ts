import assert from "node:assert/strict";
import { describe, it } from "node:test";

// The production code asks `control instanceof HTMLElement`, which node does not define. Declared before
// the import so the stubs below and the module under test read the same constructor.
class HTMLElementStub {}
(globalThis as unknown as { HTMLElement: unknown }).HTMLElement = HTMLElementStub;

const { focusFirstRefusal } = await import("./useServerFieldErrors.ts");

/** Only ever holds what `focusFirstRefusal` reads: whichever element last accepted focus. */
type Doc = { activeElement: unknown };

class Control extends HTMLElementStub {
  root: Field | null = null;
  name: string | null;
  doc: Doc;
  /** `false` stands for a hidden input or a `display: none` proxy — `focus()` on either is a no-op. */
  focusable: boolean;
  /** What the element IS, so a selector that stops describing it stops matching it. */
  tag: string;
  attributes: Record<string, string>;

  constructor(name: string | null, doc: Doc, focusable: boolean, tag = "input", attributes: Record<string, string> = {}) {
    super();
    this.name = name;
    this.doc = doc;
    this.focusable = focusable;
    this.tag = tag;
    this.attributes = attributes;
  }

  getAttribute(attribute: string): string | null {
    return attribute === "name" ? this.name : (this.attributes[attribute] ?? null);
  }

  focus(): void {
    if (this.focusable) this.doc.activeElement = this;
  }

  get ownerDocument(): Doc {
    return this.doc;
  }

  /**
   * Honours the selector rather than ignoring it. Ignored, `FOCUSABLE` and the field-root selector are free
   * variables: replacing either with nonsense moves nothing and the test keeps passing.
   */
  matches(selector: string): boolean {
    return selector.split(",").some((clause) => {
      const one = clause.trim();
      const negated = /:not\(\[type=hidden\]\)/.test(one);
      const bare = one.replace(/:not\([^)]*\)/g, "");

      if (negated && this.attributes["type"] === "hidden") return false;
      if (bare.startsWith("[")) {
        return bare
          .slice(1, -1)
          .split("][")
          .every((attribute) => {
            const [key, value] = attribute.split("=");
            const held = this.attributes[key ?? ""];
            return value === undefined ? held !== undefined : held === value.replace(/['"]/g, "");
          });
      }

      return bare === this.tag;
    });
  }

  closest(selector: string): Field | null {
    return this.root !== null && this.root.matches(selector) ? this.root : null;
  }
}

/** A react-aria field root — the `[data-rac][data-slot]` wrapper a control is found through. */
class Field {
  controls: Control[];
  attributes: Record<string, string>;

  constructor(controls: Control[], attributes: Record<string, string> = { "data-rac": "", "data-slot": "textfield" }) {
    this.controls = controls;
    this.attributes = attributes;
    for (const control of controls) control.root = this;
  }

  matches(selector: string): boolean {
    return selector
      .replace(/^\[|\]$/g, "")
      .split("][")
      .every((attribute) => {
        const [key, value] = attribute.split("=");
        const held = this.attributes[key ?? ""];
        return value === undefined ? held !== undefined : held === value.replace(/['"]/g, "");
      });
  }

  querySelectorAll(selector: string): Control[] {
    return this.controls.filter((control) => control.matches(selector));
  }
}

/** A form whose `elements` is the document-order list every case below is written against. */
const formOf = (controls: Control[]) => ({ elements: controls }) as unknown as HTMLFormElement;

describe("focusFirstRefusal", () => {
  it("focuses the first REFUSED control, not merely the first named one", () => {
    const doc: Doc = { activeElement: null };
    const innocent = new Control("vorname", doc, true, "input", { type: "text", tabindex: "0" });
    const refused = new Control("email", doc, true, "input", { type: "email", tabindex: "0" });

    assert.equal(focusFirstRefusal(formOf([innocent, refused]), { email: "Bitte gib eine Adresse ein." }), true);
    assert.equal(doc.activeElement, refused, "focus landed on a field nothing refused");
  });

  it("reaches the visible control when the named one cannot take focus", () => {
    // A `NumberField`, shaped as it renders: `name` sits on an `input type=hidden`, and the spinbutton
    // beside it carries none. The hidden input is what `FOCUSABLE`'s `:not([type=hidden])` must exclude.
    const doc: Doc = { activeElement: null };
    const spinbutton = new Control(null, doc, true, "input", { type: "text", tabindex: "0" });
    const named = new Control("kader.groesse", doc, false, "input", { type: "hidden" });
    new Field([spinbutton, named], { "data-rac": "", "data-slot": "number-field" });

    assert.equal(focusFirstRefusal(formOf([named]), { "kader.groesse": "Zu klein." }), true);
    assert.equal(doc.activeElement, spinbutton, "the caret never reached the control the admin can type into");
  });

  it("focuses the NAMED control itself when it can take focus, rather than scanning past it", () => {
    // Deleting the "did focus land?" check makes the walk fall through to the root scan every time, which
    // lands on whichever control comes first there — here the wrong one, in the same field.
    const doc: Doc = { activeElement: null };
    const decoy = new Control(null, doc, true, "button", { tabindex: "0" });
    const named = new Control("email", doc, true, "input", { type: "email", tabindex: "0" });
    new Field([decoy, named]);

    assert.equal(focusFirstRefusal(formOf([named]), { email: "Bitte gib eine Adresse ein." }), true);
    assert.equal(doc.activeElement, named, "the walk scanned past a control that could take focus itself");
  });

  it("keeps looking when a refused field can take no focus at all", () => {
    const doc: Doc = { activeElement: null };
    const proxy = new Control("rules.erlaubte_stufen", doc, false, "input", { type: "hidden" });
    new Field([proxy], { "data-rac": "", "data-slot": "toggle-group" });
    const reachable = new Control("name", doc, true, "input", { type: "text", tabindex: "0" });

    const shown = { "rules.erlaubte_stufen": "Wähle eine Stufe.", name: "Bitte gib einen Namen ein." };
    assert.equal(focusFirstRefusal(formOf([proxy, reachable]), shown), true);
    assert.equal(doc.activeElement, reachable, "an unfocusable proxy swallowed the whole walk");
  });

  it("still answers `true` when the only refused field can take no focus, so no toast claims it is unshown", () => {
    const doc: Doc = { activeElement: null };
    const proxy = new Control("rules.erlaubte_stufen", doc, false, "input", { type: "hidden" });
    new Field([proxy], { "data-rac": "", "data-slot": "toggle-group" });

    assert.equal(focusFirstRefusal(formOf([proxy]), { "rules.erlaubte_stufen": "Wähle eine Stufe." }), true);
    assert.equal(doc.activeElement, null);
  });

  it("answers `false` when no control renders the refused path, which is what raises the toast", () => {
    const doc: Doc = { activeElement: null };

    const only = new Control("vorname", doc, true, "input", { type: "text", tabindex: "0" });

    assert.equal(focusFirstRefusal(formOf([only]), { gruppe: "Wähle eine Gruppe." }), false);
  });

  it("reads the map with `hasOwn`, so a field named for a prototype key is not a match", () => {
    const doc: Doc = { activeElement: null };
    const control = new Control("constructor", doc, true, "input", { type: "text", tabindex: "0" });

    // With `in`, the empty map answers `true` here and the toast never fires for a genuinely unshown path.
    assert.equal(focusFirstRefusal(formOf([control]), {}), false);
    assert.equal(doc.activeElement, null);
  });
});

const { needsUnhandledReport, hasFieldErrors } = await import("./useServerFieldErrors.ts");

describe("when a refusal has to be announced instead of shown", () => {
  it("announces the one case the toast exists for: nothing rendered the path", () => {
    assert.equal(needsUnhandledReport({ gruppe: "Wähle eine Gruppe." }, false), true);
  });

  it("stays silent when a field did render it, which is every ordinary refusal", () => {
    // Inverted, this fires "eine Angabe außerhalb dieses Formulars" on every field error the admin can see.
    assert.equal(needsUnhandledReport({ gruppe: "Wähle eine Gruppe." }, true), false);
  });

  it("says nothing at all when there is no refusal", () => {
    assert.equal(needsUnhandledReport({}, false), false);
  });
});

describe("hasFieldErrors", () => {
  it("is false for a map with nothing in it, which is what lets the toast speak", () => {
    // True here suppresses the fallback toast in every caller, so a failure belonging to no field is silent.
    assert.equal(hasFieldErrors({}), false);
    assert.equal(hasFieldErrors(undefined), false);
  });

  it("is true once a path carries a message", () => {
    assert.equal(hasFieldErrors({ email: "Bitte gib eine Adresse ein." }), true);
  });
});

const { UNHANDLED_FIELD_REFUSAL } = await import("./useServerFieldErrors.ts");

describe("what the fallback toast says", () => {
  // Literal copy, pinned literally — but each clause below names the constraint it holds, so a rewrite that
  // breaks one fails with the reason rather than with a diff.
  it("says what the save cost, and that the work survived it", () => {
    assert.equal(
      UNHANDLED_FIELD_REFUSAL,
      "Nichts wurde gespeichert, aber Deine Eingaben stehen unverändert im Formular. Versuche es noch einmal.",
    );
  });

  it("borrows no word the triage owns", () => {
    // `ablehnen` is the application decline, and this toast can fire on that very page.
    assert.doesNotMatch(UNHANDLED_FIELD_REFUSAL, /ablehn/i);
  });

  it("never sends the reader to a reload, which would discard the entries it just promised are intact", () => {
    assert.doesNotMatch(UNHANDLED_FIELD_REFUSAL, /lade die seite|neu laden/i);
  });

  it("restates none of the condition that raised it", () => {
    // `docs/frontend/spec.md`: a toast's body says what it COST. Why no control could be marked is the app's
    // problem, and every rejected draft of this sentence has been a paraphrase of exactly that.
    assert.doesNotMatch(UNHANDLED_FIELD_REFUSAL, /grund|gehört zu kein|kein feld/i);
  });
});
