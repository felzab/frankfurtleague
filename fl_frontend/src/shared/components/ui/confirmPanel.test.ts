import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";

import { refusalWrappers, renderMarkup, textOf } from "@/shared/testing/renderTest";

import { confirmButton, formButton } from "./formButtons";
import { PANEL_REVEAL_CLASSES } from "./motion";

/*
 Reached after the harness above has evaluated, which is when the JSX compile step is registered: a
 static import beside it resolves first and dies on the extension.
*/
const { ConfirmActionRow } = await import("./ConfirmActionRow.tsx");
const { ConfirmPressButton } = await import("./ConfirmPressButton.tsx");
const { ConfirmReadoutRow } = await import("./ConfirmReadoutRow.tsx");
const { ConfirmReveal, CONFIRM_DANGER_PANEL_CLASSES } = await import("./ConfirmReveal.tsx");

/** The armed shell as a panel renders it, around a child of the panel's own. */
const REVEAL = renderMarkup(ConfirmReveal, { children: createElement("p", { id: "folge" }, "Der Spielplan wird gelöscht.") });

/** The primary control the row stands its cancel beside, whose label is the panel's rather than the row's. */
const PRIMARY = createElement("button", { type: "button" }, "Ja, löschen");

const UNARMED = renderMarkup(ConfirmActionRow, { isConfirming: false, isPending: false, onCancel: () => undefined, children: PRIMARY });
const ARMED = renderMarkup(ConfirmActionRow, { isConfirming: true, isPending: false, onCancel: () => undefined, children: PRIMARY });
const IN_FLIGHT = renderMarkup(ConfirmActionRow, { isConfirming: true, isPending: true, onCancel: () => undefined, children: PRIMARY });

const READOUT = renderMarkup(ConfirmReadoutRow, { label: "Saison", value: "2026/27" });

/** The classes on the element a component renders outermost, which is the box every claim below is about. */
const rootClasses = (html: string): string[] => (/^<\w+[^>]*\sclass="([^"]*)"/.exec(html)?.[1] ?? "").split(" ");

/** Every button the row renders, in document order, by the words standing on it. */
const labelsIn = (html: string): string[] => [...html.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map((hit) => textOf(hit[1]!));

/** The cancel's own opening tag: it is the row's second button, the panel's control being the first. */
const cancelIn = (html: string): string => [...html.matchAll(/<button\b[^>]*>/g)][1]?.[0] ?? "";

describe("the armed reveal", () => {
  /* The one mechanism every escalating panel shares. Without it the only signal that the next press
     became irreversible is the button label quietly changing, which nothing announces. */
  it("announces itself as an alert and says so in words, around the panel's own copy", () => {
    assert.match(REVEAL, /^<div role="alert"/, "the armed state is announced to nobody");
    assert.ok(REVEAL.includes("Bist Du Dir sicher?"), "the armed state announces itself without saying what it is");
    assert.ok(REVEAL.includes('id="folge"'), "the alert holds none of the consequence the panel handed it");
  });

  /* Tier 3, a section unfolding inside a page already in view, so the app's one motion vocabulary
     reaches it — and reduced motion with it, which is what `motion.ts` alone is wired for. */
  it("reveals through the shared motion token rather than its own classes", () => {
    for (const token of PANEL_REVEAL_CLASSES.split(" ")) {
      assert.ok(rootClasses(REVEAL).includes(token), `the reveal is missing ${token}, which the shared token carries`);
    }

    assert.equal(rootClasses(REVEAL).filter((token) => token === "animate-in").length, 1, "the reveal wears a second entry animation");
  });

  it("draws its tint from the constant the delete dialog draws from", () => {
    for (const token of CONFIRM_DANGER_PANEL_CLASSES.split(" ")) {
      assert.ok(rootClasses(REVEAL).includes(token), `the reveal is missing ${token}, which the shared box carries`);
    }
  });
});

describe("the armed action row", () => {
  /* A standing „Abbrechen“ beside an unarmed control offers to cancel nothing, so the cancel is the
     armed state's and stands after the control it cancels. */
  it("renders the cancel with the armed state and never before it", () => {
    assert.deepEqual(labelsIn(UNARMED), ["Ja, löschen"], "an unarmed row offers to cancel a press nobody has made");
    assert.deepEqual(labelsIn(ARMED), ["Ja, löschen", "Abbrechen"], "the armed row does not stand its cancel beside the control");
  });

  /* Held rather than taken away: a control vanishing mid-press reflows the row under the pointer,
     and a second cancel during the request would disarm a write already sent. Held, not closed, so a
     keyboard keeps its place. */
  it("holds the cancel while the write is in flight", () => {
    assert.deepEqual(labelsIn(IN_FLIGHT), ["Ja, löschen", "Abbrechen"], "the cancel leaves the row mid-press");
    assert.match(cancelIn(IN_FLIGHT), /\sdata-pending="true"/, "the cancel stays pressable while the write it would disarm is in flight");
    assert.doesNotMatch(cancelIn(IN_FLIGHT), /\sdisabled=""/, "the cancel is closed mid-press, dropping the keyboard's focus to the page");
    assert.doesNotMatch(cancelIn(ARMED), /\sdata-pending=|\sdisabled=""/, "the cancel is held before there is anything in flight");
  });

  /* The app's one cancel treatment, at the width a column asks for. */
  it("takes the cancel's fill and its column width from the shared intent", () => {
    const worn = (cancelIn(ARMED).match(/\sclass="([^"]*)"/)?.[1] ?? "").split(" ");

    for (const token of formButton({ intent: "cancel", stacks: true }).split(" ")) {
      assert.ok(worn.includes(token), `the cancel is missing ${token}, which the shared recipe emits`);
    }
  });

  /* A row wherever a pair looks uncramped, a column of FULL-WIDTH buttons where it does not — never
     a column of narrow ones. The width is the recipe's, above; the direction is the box's. */
  it("stands its buttons in a column below `sm`", () => {
    const classes = rootClasses(ARMED);

    assert.ok(classes.includes("flex-col") && classes.includes("sm:flex-row"), "the row is not a column below `sm`");
    // Every centring class rather than the scoped one's presence: `sm:items-center` is still there
    // with an unscoped one beside it, which is the shape this refuses.
    assert.deepEqual(
      classes.filter((token) => token.endsWith("items-center")),
      ["sm:items-center"],
      "the row's centring is no longer exactly the `sm:`-scoped one",
    );
  });
});

/** The shared control as a panel hands it over, in whichever of its four states a case names. */
const pressButton = (state: { isConfirming?: boolean; isPending?: boolean; held?: boolean; reason?: string | null }): string =>
  renderMarkup(ConfirmPressButton, {
    isConfirming: false,
    isPending: false,
    reason: null,
    resting: "Spielplan löschen",
    armed: "Ja, Spielplan löschen",
    running: "Löscht...",
    icon: createElement("svg", { "aria-hidden": "true", className: "size-4.5" }),
    onPress: () => undefined,
    ...state,
  });

const AT_REST = pressButton({});
const IS_ARMED = pressButton({ isConfirming: true });
const IS_WRITING = pressButton({ isConfirming: true, isPending: true });
const IS_REFUSED = pressButton({ reason: "Diese Saison hat noch keinen Spielplan." });

/** The words on the control, which is what a reader acts on and what speech input finds it by. */
const controlWords = (html: string): string =>
  textOf(/<button\b[^>]*>([\s\S]*?)<\/button>/.exec(html)?.[1] ?? "", " ")
    .replace(/\s+/g, " ")
    .trim();

const controlTag = (html: string): string => /<button\b[^>]*>/.exec(html)?.[0] ?? "";

describe("the shared confirm control", () => {
  /* The glyph announces the press, and step two announces itself in words: the two together are one
     control saying the same thing twice, so the glyph goes when the words arrive. */
  it("names the press at rest and drops its glyph once armed", () => {
    assert.equal(controlWords(AT_REST), "Spielplan löschen");
    assert.equal(controlWords(IS_ARMED), "Ja, Spielplan löschen");
    assert.match(AT_REST, /<svg/, "the resting control offers no glyph");
    assert.doesNotMatch(IS_ARMED, /<svg/, "the armed control keeps its glyph");
  });

  /* A label that never changes leaves a pressed control looking unpressed for the whole request, and
     a disabled one drops the keyboard's focus to the page mid-press (`docs/frontend/spec.md` §1.14). */
  it("says the write is running, holds the press, and never closes it", () => {
    assert.equal(controlWords(IS_WRITING), "Löscht...");
    assert.match(controlTag(IS_WRITING), /\sdata-pending="true"/, "a second press during the request sends a second write");
    assert.doesNotMatch(controlTag(IS_WRITING), /\sdisabled=""/, "the running write closes the control it was started from");
  });

  /* The overlay is the one tab stop, named by the control's own words so speech input still finds it
     (§1.14). A panel spelling this for itself is a panel whose copy drifts from `Hint`'s markup. */
  it("lays the refusal over the closed control, named by the words on it", () => {
    assert.deepEqual(refusalWrappers(IS_REFUSED), [
      { name: "Spielplan löschen", label: "Spielplan löschen", reason: "Diese Saison hat noch keinen Spielplan." },
    ]);
    assert.deepEqual(refusalWrappers(AT_REST), [], "a control nothing refuses announces a closure");
  });

  /* A panel reading before it writes holds the press on the READ, which is not the write: the label
     has to stay put, or the control reports a deletion nobody has started. */
  it("holds the press on a read without saying the write is running", () => {
    const reading = pressButton({ isConfirming: true, held: true });

    assert.equal(controlWords(reading), "Ja, Spielplan löschen", "a read reports the write as running");
    assert.match(controlTag(reading), /\sdata-pending="true"/, "a press during the read reaches the write");
    assert.doesNotMatch(controlTag(reading), /\sdisabled=""/, "the read closes the control, dropping the keyboard's focus to the page");
  });

  /* A reason and a running write arrive together on the panel that reads before it erases: the write
     is the panel's own, so it holds rather than closes, and the refusal it lifts belongs to the read. */
  it("lifts the refusal while the panel's own write runs", () => {
    const writingAndRefused = pressButton({ isPending: true, reason: "Diese Saison hat noch keinen Spielplan." });

    assert.deepEqual(refusalWrappers(writingAndRefused), [], "a running write is announced as a refusal");
    assert.doesNotMatch(controlTag(writingAndRefused), /\sdisabled=""/, "a reason standing during the write closes the control");
  });

  /* The one thing that looks different once the reveal is open, so the armed fill is what says the
     next press commits. */
  it("wears the shared armed fill, and the resting one at rest", () => {
    for (const [html, armed] of [
      [AT_REST, false],
      [IS_ARMED, true],
    ] as const) {
      const worn = (controlTag(html).match(/\sclass="([^"]*)"/)?.[1] ?? "").split(" ");

      for (const token of confirmButton(armed).split(" ")) {
        assert.ok(worn.includes(token), `${armed ? "armed" : "resting"}: the control is missing ${token}, which the shared recipe emits`);
      }
    }
  });
});

describe("the readout row", () => {
  /* A `<dt>`/`<dd>` pair and not two spans: the pair is what makes the value a fact about the label
     rather than two strings sharing a line. */
  it("renders its label and value as a description pair", () => {
    assert.match(READOUT, /<dt[^>]*>Saison<\/dt><dd[^>]*>2026\/27<\/dd>/, "the readout is two strings sharing a line");
  });
});
