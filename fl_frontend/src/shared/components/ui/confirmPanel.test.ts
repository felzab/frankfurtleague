import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";

import { refusalWrappers, renderMarkup, textOf } from "@/shared/testing/renderTest";

import { confirmButton, formButton } from "./formButtons";
import { PANEL_REVEAL_CLASSES } from "./motion";
import { NAME_WRAP_CLASSES } from "./nameWrap";
import { STEP_UP_LABEL, STEP_UP_REFUSED, STEP_UP_RUNNING } from "./stepUp";

import type { TwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";

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

/** The hook's value in the state a case names, its handlers inert: a static render presses nothing. */
const twoPress = ({
  isConfirming = false,
  isPending = false,
  asksPasskey = false,
  isPrompting = false,
  passkeyRefused = false,
}: {
  isConfirming?: boolean;
  isPending?: boolean;
  asksPasskey?: boolean;
  isPrompting?: boolean;
  passkeyRefused?: boolean;
}): TwoPressConfirm => ({
  isConfirming,
  isPending,
  asksPasskey,
  isPrompting,
  passkeyRefused,
  press: () => undefined,
  cancel: () => undefined,
});

const UNARMED = renderMarkup(ConfirmActionRow, { confirm: twoPress({}), children: PRIMARY });
const ARMED = renderMarkup(ConfirmActionRow, { confirm: twoPress({ isConfirming: true }), children: PRIMARY });
const IN_FLIGHT = renderMarkup(ConfirmActionRow, { confirm: twoPress({ isConfirming: true, isPending: true }), children: PRIMARY });

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

  /* A refused prompt leaves the control armed, so the sentence stands beside it and is announced, and
     nowhere else: a toast would be gone before the next press. */
  it("says a refused prompt under the armed control, as an alert, and only then", () => {
    const refused = renderMarkup(ConfirmActionRow, {
      confirm: twoPress({ isConfirming: true, asksPasskey: true, passkeyRefused: true }),
      children: PRIMARY,
    });

    assert.match(refused, new RegExp(`<p role="alert"[^>]*>${STEP_UP_REFUSED}</p>`), "a refused prompt is not said beside the control");
    assert.ok(!ARMED.includes(STEP_UP_REFUSED), "an armed row says a refusal nobody met");
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

/** The shared control as a panel hands it over, in whichever of its states a case names. */
const pressButton = ({
  isConfirming,
  isPending,
  asksPasskey,
  isPrompting,
  ...rest
}: {
  isConfirming?: boolean;
  isPending?: boolean;
  asksPasskey?: boolean;
  isPrompting?: boolean;
  held?: boolean;
  submitting?: boolean;
  reason?: string | null;
  restingName?: string;
}): string =>
  renderMarkup(ConfirmPressButton, {
    confirm: twoPress({ isConfirming, isPending, asksPasskey, isPrompting }),
    reason: null,
    resting: "Spielplan löschen",
    armed: "Ja, Spielplan löschen",
    running: "Löscht...",
    icon: createElement("svg", { "aria-hidden": "true", className: "size-4.5" }),
    onPress: () => undefined,
    ...rest,
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

  /* A list of closed controls with one label each is told apart only by the row's name, and closed the
     overlay is the one stop a screen reader meets, so the row's name has to reach it. */
  it("lays the refusal over a row's closed control under the row's name", () => {
    const refused = pressButton({ reason: "Diese Saison hat noch keinen Spielplan.", restingName: "Spielplan löschen: Saison 2526" });

    assert.deepEqual(refusalWrappers(refused), [
      { name: "Spielplan löschen: Saison 2526", label: "Spielplan löschen: Saison 2526", reason: "Diese Saison hat noch keinen Spielplan." },
    ]);
  });

  /* A panel reading before it writes holds the press on the READ, which is not the write: the label
     has to stay put, or the control reports a deletion nobody has started. */
  it("holds the press on a read without saying the write is running", () => {
    const reading = pressButton({ isConfirming: true, held: true });

    assert.equal(controlWords(reading), "Ja, Spielplan löschen", "a read reports the write as running");
    assert.match(controlTag(reading), /\sdata-pending="true"/, "a press during the read reaches the write");
    assert.doesNotMatch(controlTag(reading), /\sdisabled=""/, "the read closes the control, dropping the keyboard's focus to the page");
  });

  /* The confirmation's own submit runs outside the hook, so nothing but this prop tells the control a
     write is running at rest. */
  it("says the form's own one-press write is running, holding the press", () => {
    const submitting = pressButton({ submitting: true });

    assert.equal(controlWords(submitting), "Löscht...", "the form's own write leaves the resting label standing");
    assert.match(controlTag(submitting), /\sdata-pending="true"/, "a second press during the submit sends it twice");
    assert.doesNotMatch(controlTag(submitting), /\sdisabled=""/, "the running submit closes the control it was started from");
  });

  /* A reason and a running write arrive together on the panel that reads before it erases: the write
     is the panel's own, so it holds rather than closes, and the refusal it lifts belongs to the read. */
  it("lifts the refusal while the panel's own write runs", () => {
    const writingAndRefused = pressButton({ isPending: true, reason: "Diese Saison hat noch keinen Spielplan." });

    assert.deepEqual(refusalWrappers(writingAndRefused), [], "a running write is announced as a refusal");
    assert.doesNotMatch(controlTag(writingAndRefused), /\sdisabled=""/, "a reason standing during the write closes the control");
  });

  /* The armed press of an irreversible write the page must confirm first opens the browser's passkey
     prompt, so its label names that prompt and not the write; running, it still says the write. */
  it("names the passkey prompt on the armed press of a write the page must confirm first", () => {
    assert.equal(controlWords(pressButton({ isConfirming: true, asksPasskey: true })), STEP_UP_LABEL);
    assert.equal(controlWords(pressButton({ isConfirming: true, isPending: true, asksPasskey: true })), "Löscht...");
    assert.equal(
      controlWords(pressButton({ isConfirming: true, isPending: true, asksPasskey: true, isPrompting: true })),
      STEP_UP_RUNNING,
      "the open prompt says the write is running, where nothing has been sent",
    );
    assert.equal(controlWords(pressButton({ asksPasskey: false })), "Spielplan löschen", "the resting control names the prompt");
  });

  /* A label may carry a word the page does not write, an address among them, wider than the control on
     a phone. Each box between that word and the card must give way, so each is asserted. */
  it("lets a word wider than the control break inside it rather than widen the card", () => {
    const classesOf = (tag: string): string[] => (/\sclass="([^"]*)"/.exec(tag)?.[1] ?? "").split(" ");
    const labelTag = /<button\b[^>]*>[\s\S]*?(<span\b[^>]*>)/.exec(AT_REST)?.[1] ?? "";

    assert.ok(rootClasses(AT_REST).includes("min-w-0"), "the wrapper keeps the label's longest word as its floor in the `sm` row");
    assert.ok(classesOf(controlTag(AT_REST)).includes("max-w-full"), "the control grows past its wrapper to seat the longest word");
    for (const token of ["min-w-0", ...NAME_WRAP_CLASSES.split(" ")]) {
      assert.ok(classesOf(labelTag).includes(token), `the label is missing ${token}, so a long word leaves the control`);
    }
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

  /* Either side may hold a name somebody typed, a team's in „Austritt von {Team}“, a person's as a value:
     each is a flex item that keeps its longest word as its floor unless it may shrink and break it. */
  it("lets either side break a word wider than the reveal", () => {
    const classesOf = (tag: string): string[] => (/\sclass="([^"]*)"/.exec(tag)?.[1] ?? "").split(" ");

    for (const side of ["dt", "dd"]) {
      const worn = classesOf(new RegExp(`<${side}\\b[^>]*>`).exec(READOUT)?.[0] ?? "");
      for (const token of ["min-w-0", ...NAME_WRAP_CLASSES.split(" ")]) {
        assert.ok(worn.includes(token), `the readout's ${side} is missing ${token}, so a long name runs past the reveal`);
      }
    }
  });
});

describe("the danger box both escalations stand in", () => {
  /* Inherited by every sentence the box holds, the panel's own and the delete dialog's: a sentence may
     name an address or a team, one word wider than the box on a phone. */
  it("breaks a word wider than the box inside it", () => {
    assert.ok(rootClasses(REVEAL).includes("wrap-break-word"), "a sentence in the reveal runs a long word past its edge");
  });
});
