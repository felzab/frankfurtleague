import assert from "node:assert/strict";
import { describe, it } from "node:test";

// The production code asks `control instanceof HTMLElement`, which node does not define. Declared before
// the import so the stubs below and the module under test read the same constructor.
class HTMLElementStub {}
(globalThis as unknown as { HTMLElement: unknown }).HTMLElement = HTMLElementStub;

const { focusFirstRefusal } = await import("./useServerFieldErrors.ts");

/** Only ever holds what `focusFirstRefusal` reads: whichever element last accepted focus. */
type Doc = { activeElement: unknown };

type Attrs = Record<string, string>;

/**
 * A tree, not a bag. Both shapes production survives are about WHERE the named control sits, so a stub whose
 * `closest` ignores its argument expresses neither and passes whatever the walk does.
 */
class El extends HTMLElementStub {
  tag: string;
  attributes: Attrs;
  children: El[] = [];
  parent: El | null = null;
  doc: Doc;
  /** `false` stands for a hidden input or a `display: none` proxy — `focus()` on either is a no-op. */
  focusable: boolean;

  constructor(tag: string, attributes: Attrs, doc: Doc, focusable = false) {
    super();
    this.tag = tag;
    this.attributes = attributes;
    this.doc = doc;
    this.focusable = focusable;
  }

  add(...children: El[]): this {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }

    return this;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  get ownerDocument(): Doc {
    return this.doc;
  }

  get parentElement(): El | null {
    return this.parent;
  }

  get previousElementSibling(): El | null {
    const siblings = this.parent?.children ?? [];

    return siblings[siblings.indexOf(this) - 1] ?? null;
  }

  focus(): void {
    if (this.focusable) this.doc.activeElement = this;
  }

  /** One compound selector: a tag, any number of attribute terms, and one `:not(...)`. */
  matchesOne(clause: string): boolean {
    const negated = /:not\(([^)]*)\)/.exec(clause);
    if (negated !== null && this.matchesOne(negated[1] ?? "")) return false;

    const bare = clause.replace(/:not\([^)]*\)/g, "").trim();
    const tag = /^[a-z]+/.exec(bare)?.[0];
    if (tag !== undefined && tag !== this.tag) return false;

    for (const term of bare.matchAll(/\[([a-z-]+)(?:=["']?([^\]"']*)["']?)?\]/g)) {
      const held = this.attributes[term[1] ?? ""];
      if (held === undefined) return false;
      if (term[2] !== undefined && held !== term[2]) return false;
    }

    return true;
  }

  matches(selector: string): boolean {
    return selector.split(",").some((clause) => this.matchesOne(clause.trim()));
  }

  closest(selector: string): El | null {
    // Self first, as the DOM does: a control carrying its own field root's attributes is the case that breaks.
    if (this.matches(selector)) return this;

    return this.parent?.closest(selector) ?? null;
  }

  descendants(): El[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  querySelectorAll(selector: string): El[] {
    return this.descendants().filter((node) => node.matches(selector));
  }
}

/** `form.elements` is every named control in document order, as the browser reports it. */
const formOf = (root: El) =>
  ({
    elements: root.querySelectorAll("input,select,textarea,button").filter((node) => node.getAttribute("name") !== null),
  }) as unknown as HTMLFormElement;

const FOCUSABLE = { tabindex: "0" };
const ROOT = (slot: string) => ({ "data-rac": "", "data-slot": slot });

describe("focusFirstRefusal", () => {
  it("focuses the first REFUSED control, not merely the first named one", () => {
    const doc: Doc = { activeElement: null };
    const innocent = new El("input", { name: "vorname", type: "text", ...FOCUSABLE }, doc, true);
    const refused = new El("input", { name: "email", type: "email", ...FOCUSABLE }, doc, true);
    const form = new El("form", {}, doc).add(
      new El("div", ROOT("textfield"), doc).add(innocent),
      new El("div", ROOT("textfield"), doc).add(refused),
    );

    assert.equal(focusFirstRefusal(formOf(form), { email: "Bitte gib eine Adresse ein." }), true);
    assert.equal(doc.activeElement, refused, "focus landed on a field nothing refused");
  });

  it("never parks focus in a subtree assistive technology cannot see", () => {
    // A `Select`: the name lives on react-aria's hidden mirror, which takes focus happily and announces
    // nothing. The trigger beside it is the control a reader is actually on.
    const doc: Doc = { activeElement: null };
    const trigger = new El("button", { ...FOCUSABLE }, doc, true);
    const mirror = new El("select", { name: "team_id", tabindex: "-1" }, doc, true);
    const form = new El("form", {}, doc).add(
      new El("div", ROOT("select"), doc).add(
        trigger,
        new El("div", { "aria-hidden": "true", "data-react-aria-prevent-focus": "true" }, doc).add(new El("label", {}, doc).add(mirror)),
      ),
    );

    assert.equal(focusFirstRefusal(formOf(form), { team_id: "Bitte wähle eine Schule." }), true);
    assert.equal(doc.activeElement, trigger, "focus parked inside an aria-hidden subtree, where nothing is announced");
  });

  it("reaches the spinbutton when the name sits BESIDE the field rather than inside it", () => {
    // A `NumberField`: its named input is a child of the form, next to the root. Asking `closest` of that
    // input finds no field at all, so the sibling arm is the only route to the box the admin types in.
    const doc: Doc = { activeElement: null };
    const spinbutton = new El("input", { type: "text", ...FOCUSABLE }, doc, true);
    const named = new El("input", { type: "hidden", name: "kader.groesse" }, doc);
    const form = new El("form", {}, doc).add(new El("div", ROOT("number-field"), doc).add(spinbutton), named);

    assert.equal(focusFirstRefusal(formOf(form), { "kader.groesse": "Zu klein." }), true);
    assert.equal(doc.activeElement, spinbutton, "the caret never reached the control the admin can type into");
  });

  it("reaches the switch when the named proxy IS its own field root", () => {
    // The consent proxy carries `data-rac` and `data-slot` itself, so a `closest` that starts at the control
    // answers with the control, and searching inside an `<input>` finds nothing.
    const doc: Doc = { activeElement: null };
    const toggle = new El("input", { type: "checkbox", role: "switch", ...FOCUSABLE }, doc, true);
    const proxy = new El("input", { type: "text", name: "einwilligung.erteilt", ...ROOT("input") }, doc);
    const form = new El("form", {}, doc).add(new El("div", ROOT("textfield"), doc).add(new El("div", ROOT("switch"), doc).add(toggle), proxy));

    assert.equal(focusFirstRefusal(formOf(form), { "einwilligung.erteilt": "Bitte stimme zu." }), true);
    assert.equal(doc.activeElement, toggle, "the consent switch never took the caret its own refusal names");
  });

  it("focuses the NAMED control itself when it can take focus, rather than scanning past it", () => {
    const doc: Doc = { activeElement: null };
    const decoy = new El("button", { ...FOCUSABLE }, doc, true);
    const named = new El("input", { name: "email", type: "email", ...FOCUSABLE }, doc, true);
    const form = new El("form", {}, doc).add(new El("div", ROOT("textfield"), doc).add(decoy, named));

    assert.equal(focusFirstRefusal(formOf(form), { email: "Bitte gib eine Adresse ein." }), true);
    assert.equal(doc.activeElement, named, "the walk scanned past a control that could take focus itself");
  });

  it("keeps looking when a refused field can take no focus at all", () => {
    const doc: Doc = { activeElement: null };
    const proxy = new El("input", { type: "hidden", name: "rules.erlaubte_stufen" }, doc);
    const reachable = new El("input", { name: "name", type: "text", ...FOCUSABLE }, doc, true);
    const form = new El("form", {}, doc).add(
      new El("div", ROOT("toggle-group"), doc),
      proxy,
      new El("div", ROOT("textfield"), doc).add(reachable),
    );

    const shown = { "rules.erlaubte_stufen": "Wähle eine Stufe.", name: "Bitte gib einen Namen ein." };
    assert.equal(focusFirstRefusal(formOf(form), shown), true);
    assert.equal(doc.activeElement, reachable, "an unfocusable proxy swallowed the whole walk");
  });

  it("still answers `true` when the only refused field can take no focus, so no toast claims it is unshown", () => {
    const doc: Doc = { activeElement: null };
    const proxy = new El("input", { type: "hidden", name: "rules.erlaubte_stufen" }, doc);
    const form = new El("form", {}, doc).add(new El("div", ROOT("toggle-group"), doc), proxy);

    assert.equal(focusFirstRefusal(formOf(form), { "rules.erlaubte_stufen": "Wähle eine Stufe." }), true);
    assert.equal(doc.activeElement, null);
  });

  it("answers `false` when no control renders the refused path, which is what raises the toast", () => {
    const doc: Doc = { activeElement: null };
    const only = new El("input", { name: "vorname", type: "text", ...FOCUSABLE }, doc, true);
    const form = new El("form", {}, doc).add(new El("div", ROOT("textfield"), doc).add(only));

    assert.equal(focusFirstRefusal(formOf(form), { gruppe: "Wähle eine Gruppe." }), false);
  });

  it("reads the map with `hasOwn`, so a field named for a prototype key is not a match", () => {
    const doc: Doc = { activeElement: null };
    const control = new El("input", { name: "constructor", type: "text", ...FOCUSABLE }, doc, true);
    const form = new El("form", {}, doc).add(new El("div", ROOT("textfield"), doc).add(control));

    // With `in`, the empty map answers `true` here and the toast never fires for a genuinely unshown path.
    assert.equal(focusFirstRefusal(formOf(form), {}), false);
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

const { blockedSubmitDetail, BLOCKED_SUBMIT_TITLE } = await import("./useDraftFieldErrors.ts");

describe("what a blocked submit announces", () => {
  it("says how many answers are missing, spelled per count", () => {
    // A `FieldError` is a plain span in no live region, so without a toast the press is silent to a reader.
    assert.match(blockedSubmitDetail(1), /^Ein Feld/);
    assert.match(blockedSubmitDetail(4), /^4 Felder/);
  });

  it("points at the marks rather than restating them", () => {
    assert.match(blockedSubmitDetail(2), /markiert/);
  });

  it("sends the reader in no direction, on either count", () => {
    // Every editor on the site shares this sentence, and on the public application form the marked field
    // stands above the button that raised it. `focusFirstRefusal` moves the caret to the mark regardless.
    const richtung = /\bunten\b|\boben\b|darunter|darüber/i;
    const gesagt = "the toast names a place only some of the forms sharing it put the mark";

    assert.doesNotMatch(blockedSubmitDetail(1), richtung, gesagt);
    assert.doesNotMatch(blockedSubmitDetail(4), richtung, gesagt);
  });

  it("says the save did not happen, in a title distinct from every other refusal", () => {
    assert.equal(BLOCKED_SUBMIT_TITLE, "Noch nicht abgeschickt");
  });
});
