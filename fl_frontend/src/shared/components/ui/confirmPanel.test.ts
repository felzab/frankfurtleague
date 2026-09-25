import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement } from "react";

import { blankComments } from "@/core/blankComments.ts";
import { openingTag } from "@/core/openingTag.ts";
import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
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

/** The shared control's tag, which is also what a panel is searched for: one name, spelled once. */
const CONTROL = "ConfirmPressButton";

/* Blanked rather than raw: `ConfirmReveal`'s JSDoc names `role="alert"` while explaining it, so a
   panel's `doesNotMatch` of that string fails it for saying so. */
const read = (file: string): string => blankComments(readFileSync(path.resolve(import.meta.dirname, file), "utf8"));

const REVEAL_SOURCE = read("ConfirmReveal.tsx");
const ACTION_ROW_SOURCE = read("ConfirmActionRow.tsx");
const DELETE_MODAL_SOURCE = read("ConfirmDeleteModal.tsx");

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

/**
 * Every panel that escalates a press, discovered rather than typed.
 *
 * A roster counted against its own length reports no omission, and neither does one compared against
 * a filter of itself: the two below are found independently and must agree.
 */
const panelsUnder = (dir: string, holds: (source: string, file: string) => boolean): string[] =>
  filesUnder(dir, (name) => name.endsWith(".tsx") && !isTestFile(name), 100).filter((full) => holds(readFileSync(full, "utf8"), full));

const FEATURES = path.resolve(import.meta.dirname, "..", "..", "..", "features");
const named = (files: string[]): string[] =>
  files.map((file) =>
    path
      .relative(import.meta.dirname, file)
      .split(path.sep)
      .join("/"),
  );

const PANELS = named(panelsUnder(FEATURES, (source) => source.includes("useTwoPressConfirm(")));

/** What makes a tag a control: a panel arming under a component this cannot name sits in neither
    roster, and two rosters missing the same file agree. */
const PRESS = /\bon(?:Press|Click)=\{/;
/** The Button family beside the press, so a control taking a press by a route this cannot see is still found. */
const CONTROL_NAME = /^[\w.]*[Bb]utton$/;
const CONTROL_INSIDE = /<[\w.]*[Bb]utton\b|\bon(?:Press|Click)=\{/;

type Control = { tag: string; inner: string; from: number; to: number };

/**
 * Every control in one source, as its opening tag and the region it branches on, and every wrapper
 * whose own press guards the control inside it rather than committing anything.
 */
function controls(source: string, file: string): { found: Control[]; guards: [number, number][] } {
  const found: Control[] = [];
  const guards: [number, number][] = [];

  for (let at = 0; ;) {
    const hit = /<([A-Za-z][\w.]*)/.exec(source.slice(at));
    if (hit === null) return { found, guards };

    const opensAt = at + hit.index;
    const name = hit[1]!;
    const tag = openingTag(source, opensAt);
    const isNamed = CONTROL_NAME.test(name);
    // Throw rather than skip: a control this cannot read drops its whole panel out of the roster,
    // which is the silent loss a second discriminator exists to prevent.
    if (isNamed && tag === "") throw new Error(`${file}: a control's opening tag could not be read`);

    if (!isNamed && !(tag !== "" && PRESS.test(tag))) {
      at = opensAt + 1;
      continue;
    }

    if (tag.endsWith("/>")) {
      // Its own attributes are the region it branches on: a control with no children rewords itself
      // through a prop, and a panel spelled that way would otherwise sit in neither roster.
      found.push({ tag, inner: tag, from: opensAt, to: opensAt + tag.length });
      at = opensAt + tag.length;
      continue;
    }

    const closesAt = source.indexOf(`</${name}>`, opensAt);
    if (closesAt === -1) throw new Error(`${file}: a control never closes`);
    const inner = source.slice(opensAt + tag.length, closesAt);

    if (!isNamed && CONTROL_INSIDE.test(inner)) {
      // A press around a control guards that control rather than committing anything, so judging the
      // outer tag would read the inner one's branches against the outer one's `isDisabled`.
      guards.push([opensAt, opensAt + tag.length]);
      at = opensAt + tag.length;
      continue;
    }

    found.push({ tag, inner, from: opensAt, to: closesAt });
    at = closesAt + 1;
  }
}

/** The braced value of one attribute, brace-counted so a nested object or an arrow does not end it. */
function attributeValue(tag: string, name: string, file: string): string {
  // Bounded on the left so `isDisabled={…}` and `aria-disabled={…}` are not read as the plain
  // spelling: a control closed by one this misses is promoted onto the roster as an arming one.
  const written = new RegExp(String.raw`(?<![\w-])` + name + String.raw`=\{`).exec(tag);
  if (written === null) return "";

  const from = tag.indexOf("{", written.index);
  let depth = 0;

  for (let at = from; at < tag.length; at++) {
    if (tag[at] === "{") depth += 1;
    else if (tag[at] === "}") {
      depth -= 1;
      if (depth === 0) return tag.slice(from + 1, at);
    }
  }

  throw new Error(`${file}: ${name} never closes`);
}

/** The `||` operands at the top level: a flag nested inside one does not close the control alone. */
function disjuncts(expression: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;

  for (let at = 0; at < expression.length; at++) {
    const here = expression[at]!;

    if ("([{".includes(here)) depth += 1;
    else if (")]}".includes(here)) depth -= 1;
    else if (depth === 0 && here === "|" && expression[at + 1] === "|") {
      parts.push(expression.slice(from, at).trim());
      at += 1;
      from = at + 1;
    }
  }

  parts.push(expression.slice(from).trim());

  return parts;
}

/** A flag as a reader writes one: a bare name, or a member of the object holding the panel's state. */
const FLAG = String.raw`([A-Za-z_$][\w$]*(?:\.[\w$]+)*)`;
/** The condition of a branch wherever one stands, a reveal computed into a variable included. */
const BRANCHED = new RegExp(String.raw`[{=(,:]\s*!?\s*` + FLAG + String.raw`\s*(?:&&|\?)`, "g");
/** A flag handed to a component, which reveals whatever that component renders. */
const HANDED = new RegExp(String.raw`\b[\w-]+=\{\s*!?\s*` + FLAG + String.raw`\s*\}`, "g");

/** The identifiers a region outside every control is revealed by, gated in a brace or handed on. */
const revealedIn = (source: string): Set<string> => new Set([...source.matchAll(BRANCHED), ...source.matchAll(HANDED)].map((hit) => hit[1]!));

const BRANCH = new RegExp(String.raw`[{:(]\s*!?\s*` + FLAG + String.raw`\s*(?:&&|\?)`, "g");

/** The identifiers a control's children branch on, a negation and a ternary's later arms included. */
const branchesOf = (inner: string): Set<string> => new Set([...inner.matchAll(BRANCH)].map((hit) => hit[1]!));

/**
 * The identifiers the SHARED control is handed, it alone wording itself from a flag while branching
 * nothing. Off that tag only: a card handed a season's state beside an `onPress` reads the same.
 */
const wordedBy = (tag: string): Set<string> =>
  tag.startsWith(`<${CONTROL}`) ? new Set([...tag.matchAll(HANDED)].map((hit) => hit[1]!)) : new Set();

/**
 * An ARMING flag reveals a region outside the control, rewords the control that commits, and leaves
 * it pressable. The last clause parts it from a flag that only says a write is in flight, which
 * closes the control.
 */
function armsAPress(source: string, file: string): boolean {
  const { found, guards } = controls(source, file);
  // Split by code unit rather than spread by code point: every `from` and `to` above is `indexOf`'s
  // or `length`'s, and one astral character puts a code-point array a position out from there on.
  const outside = source.split("");
  // Blanked rather than cut out: two spans that overlap would join the text on either side of them
  // into a gate neither half holds.
  const blank = ([from, to]: [number, number]): void => {
    for (let at = from; at < to; at++) if (outside[at] !== "\n") outside[at] = " ";
  };
  for (const { from, to } of found) blank([from, to]);
  for (const huelle of guards) blank(huelle);

  const outer = outside.join("");
  // A press standing here belongs to no control above — a tag whose generic argument stopped the
  // walk reading it — and a panel this reader skipped whole is in neither roster.
  if (PRESS.test(outer)) throw new Error(`${file}: a press stands outside every control this reader can read`);

  // Read off what is left when every control is gone, so a flag branching the control's own label
  // can never stand in for the region it is supposed to reveal.
  const gates = revealedIn(outer);

  return found.some(({ tag, inner }) => {
    // Every spelling: a native `<button>` takes `disabled`, HeroUI holds a running press with `isPending`, and a
    // submitting form whose control this reads as open lands on the roster beside the panels that actually arm.
    const closed = new Set(["isDisabled", "disabled", "isPending"].flatMap((attribut) => disjuncts(attributeValue(tag, attribut, file))));

    return [...branchesOf(inner), ...wordedBy(tag)].some((flag) => gates.has(flag) && !closed.has(flag));
  });
}

/* What a panel IS rather than what it imports: `isConfirming` is the name the shared hook's return
   is destructured to, so a roster reading that name is the roster above under a second spelling. */
const PANELS_BY_SHAPE = named(panelsUnder(FEATURES, (source, file) => armsAPress(blankComments(source), file)));

/* Every panel in the tree arms under one name, so no count over the tree separates a reader of the
   shape from a reader of that name. These are what the tree cannot show. */
const HAND_ROLLED = [
  "export function FormLoeschenSection() {",
  "  const [bestaetigt, setBestaetigt] = useState(false);",
  "  const [laeuft, setLaeuft] = useState(false);",
  "  return (",
  "    <section>",
  "      {bestaetigt && (",
  '        <div role="alert">',
  "          <p>Bist Du Dir sicher?</p>",
  "        </div>",
  "      )}",
  "      <Button",
  "        isDisabled={laeuft}",
  "        onPress={() => (bestaetigt ? loeschen() : setBestaetigt(true))}",
  '        className={bestaetigt ? "bg-danger" : "bg-default"}>',
  "        {!bestaetigt && <TrashBin />}",
  '        {laeuft ? "Löscht..." : bestaetigt ? "Ja, endgültig löschen" : "Löschen"}',
  "      </Button>",
  "    </section>",
  "  );",
  "}",
].join("\n");

const ONLY_IN_FLIGHT = [
  "export function BewerbungForm() {",
  "  const [sendet, setSendet] = useState(false);",
  "  return (",
  "    <Form>",
  "      {sendet && <Spinner />}",
  "      <Button",
  "        isDisabled={sendet}>",
  "        {!sendet && <Paperclip />}",
  '        {sendet ? "Sendet..." : "Absenden"}',
  "      </Button>",
  "    </Form>",
  "  );",
  "}",
].join("\n");

/* One escalation per spelling, each defeating a reader anchored on `{flag && …}` beside a `<Button>`
   with children: a panel wearing one sits in neither roster, and the two then agree over nothing. */
const SPELLINGS: Record<string, string> = {
  "a control named for the press rather than the element":
    '{armed && <Alarm />}\n<PressButton isDisabled={laeuft} onPress={go}>{armed ? "Ja" : "Los"}</PressButton>',
  "a control with no Button anywhere in its name":
    '{armed && <Alarm />}\n<Pressable isDisabled={laeuft} onPress={go}>{armed ? "Ja" : "Los"}</Pressable>',
  "a Button-family control taking its press from the form":
    '{armed && <Alarm />}\n<DangerButton isDisabled={laeuft} type="submit">{armed ? "Ja" : "Los"}</DangerButton>',
  "a self-closing control taking its label as a prop":
    '{armed && <Alarm />}\n<Button isDisabled={laeuft} label={armed ? "Ja" : "Los"} onPress={go} />',
  "the shared control, which words itself from the flag it is handed": `{armed && <Alarm />}\n<${CONTROL} isConfirming={armed} isPending={laeuft} resting="Los" armed="Ja" onPress={go} />`,
  "a reveal gated on a member of the state object":
    '{zustand.armed && <Alarm />}\n<Button isDisabled={laeuft}>{zustand.armed ? "Ja" : "Los"}</Button>',
  "a reveal handed to a component as a prop": '<Alarm isOpen={armed} />\n<Button isDisabled={laeuft}>{armed ? "Ja" : "Los"}</Button>',
  "a reveal computed into a variable the brace renders":
    'const folge = armed ? <Alarm /> : null;\n{folge}\n<Button isDisabled={laeuft}>{armed ? "Ja" : "Los"}</Button>',
};

/* The shape the widened reader put on the roster: a card opening a modal carries a press and a flag
   the page also gates a region by, and neither token says anything about an armed state. */
const CARD_TAKING_A_PRESS =
  "{isFinishedSaison && <Empty />}\n<SpielCardUltraCompact spielData={spielData} isFinishedSaison={isFinishedSaison} onPress={open} />";

const NATIVE_IN_FLIGHT = '{sendet && <Spinner />}\n<button disabled={sendet}>{sendet ? "Sendet..." : "Absenden"}</button>';

const HELD_IN_FLIGHT = '{sendet && <Spinner />}\n<Button isPending={sendet}>{sendet ? "Sendet..." : "Absenden"}</Button>';

/* The reveal stands against the wrapper's own `>` or this sample cannot fail: `armsAPress` blanks by
   code-unit offsets, and a surrogate pair above the span moves what it blanks onto that reveal. */
const wrappedAfter = (head: string): string =>
  `${head}<div onPress={guard}>{armed && <Alarm />}<Button isDisabled={laeuft} onPress={go}>{armed ? "Ja" : "Los"}</Button></div>`;

describe("the shape the second roster reads", () => {
  /* The failure the pair exists to catch: a panel that arms without importing the hook. Its flag is
     spelled differently on purpose — the shared spelling is the one both routes already share. */
  it("finds a panel arming its own state under a name of its own", () => {
    assert.ok(!HAND_ROLLED.includes("useTwoPressConfirm(") && !HAND_ROLLED.includes("isConfirming"), "the sample takes the shared spelling");
    assert.ok(
      armsAPress(blankComments(HAND_ROLLED), "hand-rolled"),
      "a panel arming its own state under its own name is absent from the roster",
    );
  });

  it("finds a panel arming a press however its control and its reveal are spelled", () => {
    for (const [what, spelling] of Object.entries(SPELLINGS)) {
      assert.ok(armsAPress(blankComments(spelling), what), `${what}: absent from the roster`);
    }
  });

  it("finds a panel whose own copy carries an astral character", () => {
    assert.ok(
      armsAPress(blankComments(wrappedAfter("<p>Postfach</p>\n")), "without"),
      "the sample is off the roster with no glyph in it at all",
    );
    assert.ok(
      armsAPress(blankComments(wrappedAfter("<p>Postfach \u{1F4EC}</p>\n")), "with"),
      "one emoji in a panel's copy drops that panel out of the roster",
    );
  });

  /* A flag saying the write is in flight reveals a region and rewords the control exactly as an
     arming one does, so a reader taking those two alone puts every submitting form on the roster. */
  it("passes over a control that only closes while its write is in flight", () => {
    assert.ok(!armsAPress(blankComments(ONLY_IN_FLIGHT), "in flight"), "a form that only reports its own request is on the roster");
  });

  /* A press handler beside a prop the page also gates a region by is two tokens every card that
     opens a modal carries, and neither of them is an armed state wording that card's own label. */
  it("passes over a card that takes a press beside a flag the page gates by", () => {
    assert.ok(!armsAPress(blankComments(CARD_TAKING_A_PRESS), "card"), "a card opening a modal is on the roster");
  });

  /* `isDisabled` is HeroUI's spelling and a native control takes `disabled`, so a reader holding
     only the first reads an ordinary submitting form as one that escalates. */
  it("passes over a native button closed by the plain `disabled` spelling", () => {
    assert.ok(!armsAPress(blankComments(NATIVE_IN_FLIGHT), "native"), "a native control closing on its own request is on the roster");
  });

  /* The spelling every write holds its control with, so a reader missing it puts every submitting form on the roster. */
  it("passes over a control HeroUI holds with `isPending` while its write is in flight", () => {
    assert.ok(!armsAPress(blankComments(HELD_IN_FLIGHT), "held"), "a control held on its own request is on the roster");
  });

  /* A control the reader cannot parse would otherwise leave its panel out of the population, where a
     missing member reads as agreement between the two routes. */
  it("fails on a control it cannot read rather than dropping its panel", () => {
    assert.throws(() => armsAPress("<Button isDisabled={x}>{y ? 1 : 2}", "unclosed"), /never closes/);
    assert.throws(() => armsAPress("<Button title={x}<div></Button>", "tangled"), /could not be read/);
  });

  /* The residue of the walk above, on a tag whose name is no control's: a lost brace count stops the
     tag being read, and a press on such a tag belongs to a control this reader never judged. */
  it("fails on a press it could not place rather than passing the file over", () => {
    assert.throws(
      () => armsAPress("<Pressable title={x}<div> onPress={() => go()}>{armed ? 1 : 2}</Pressable>", "unreadable"),
      /stands outside every control/,
    );
  });
});

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
    // A literal spelling the same classes renders identically, so which of the two stands here is
    // legible in the source alone.
    assert.match(REVEAL_SOURCE, /\$\{PANEL_REVEAL_CLASSES\}/, "the reveal spells its motion beside the vocabulary the app keeps");
  });

  /* One gap for every panel on the roster. A prop here would be a variant prop under another name,
     which `docs/frontend/spec.md :: I67` refuses for exactly this shape. */
  it("takes no variant of any kind", () => {
    for (const token of ["flex", "flex-col", "gap-4"]) {
      assert.ok(rootClasses(REVEAL).includes(token), `the reveal is missing ${token}, so its gap is no longer one decision`);
    }

    // A knob nobody has passed yet changes nothing it renders, so the declaration is where one shows.
    assert.doesNotMatch(REVEAL_SOURCE, /\bvariant\b|\bgap\?:|\btone\b/, "the shell grew a knob");
  });

  /* The delete dialog takes the box and not the reveal, for the reason its own step-2 comment gives
     (`fl_frontend/src/shared/components/ui/ConfirmDeleteModal.tsx`). Two spellings of that box render
     identically, so which of them stands there is legible in the source alone. */
  it("draws its tint from the constant the delete dialog draws from", () => {
    for (const token of CONFIRM_DANGER_PANEL_CLASSES.split(" ")) {
      assert.ok(rootClasses(REVEAL).includes(token), `the reveal is missing ${token}, which the shared box carries`);
    }

    assert.match(DELETE_MODAL_SOURCE, /\$\{CONFIRM_DANGER_PANEL_CLASSES\}/, "the delete dialog's step two dresses a box of its own");
    assert.doesNotMatch(DELETE_MODAL_SOURCE, /bg-danger\/5\b|border-danger\/20\b/, "the delete dialog spells the box beside the constant");
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

  /* The app's one cancel treatment, at the width a column asks for. Spell the classes here and this
     row drifts from every other form's pair the first time `formButton` moves. */
  it("takes the cancel's fill and its column width from the shared intent", () => {
    const worn = (cancelIn(ARMED).match(/\sclass="([^"]*)"/)?.[1] ?? "").split(" ");

    for (const token of formButton({ intent: "cancel", stacks: true }).split(" ")) {
      assert.ok(worn.includes(token), `the cancel is missing ${token}, which the shared recipe emits`);
    }

    // Two recipes emitting the same classes render alike, so a copy is legible in the source alone.
    assert.match(ACTION_ROW_SOURCE, /formButton\(\{ intent: "cancel", stacks: true \}\)/, "the cancel is dressed beside the shared recipe");
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

/** The shared control as a panel writes it, which is self-closing: every branch inside it is the component's. */
function armedControl(source: string): string {
  const opens = source.indexOf(`<${CONTROL}`);

  return opens === -1 ? "" : openingTag(source, opens);
}

function panelsMatching(needle: string): string[] {
  return PANELS.filter((file) => read(file).includes(needle));
}

describe("every panel that escalates a press", () => {
  /* The whole point of the extraction. A panel spelling the shell again is one that drifts from the
     rest the next time any of the three shared components moves. */
  it("render the shared mechanism rather than spelling their own", () => {
    // The reveal and the control are filters of this roster, so they catch a panel spelling its own
    // shell and never one the hook import left out of the walk. `PANELS_BY_SHAPE` is the route that
    // catches that.
    const byReveal = panelsMatching("<ConfirmReveal>");
    const byControl = panelsMatching(`<${CONTROL}`);

    assert.ok(PANELS.length > 0, "the sweep found no panels at all, so every case below passes over nothing");
    assert.deepEqual(PANELS, PANELS_BY_SHAPE, "a panel arms a press without taking the shared hook, or the reverse");
    assert.deepEqual(PANELS, byReveal, "a panel renders the shared reveal without the shared armed state, or the reverse");
    assert.deepEqual(PANELS, byControl, "a panel renders the shared control without the shared armed state, or the reverse");

    for (const file of PANELS) {
      const source = read(file);

      assert.match(source, /<ConfirmReveal>/, `${file}: does not render the shared reveal`);
      assert.match(source, /<ConfirmActionRow/, `${file}: does not render the shared action row`);
      assert.doesNotMatch(source, /role="alert"/, `${file}: spells its own alert`);
      assert.doesNotMatch(source, /Bist Du Dir sicher/, `${file}: spells its own announcement`);
      // Every clause of the control is the component's now, so a panel reaching for any of them is
      // one building a second shell beside the shared one.
      assert.doesNotMatch(source, /confirmButton\(/, `${file}: grades its own armed fill`);
      // Around the SHARED control alone: a panel offering a second, one-press control refuses on that
      // one itself, and `FormSaisonSection`'s season entry is exactly that.
      const at = source.indexOf(`<${CONTROL}`);
      const wrapping = source.lastIndexOf("<Hint", at);
      assert.ok(wrapping === -1 || source.indexOf("</Hint>", wrapping) < at, `${file}: lays its own refusal over the armed control`);
      // The armed state alone. A panel may still hold its own `useTransition` for a one-press write
      // beside the two-press control — `FormSaisonSection`'s season entry is exactly that.
      assert.doesNotMatch(source, /setIsConfirming/, `${file}: keeps its own armed state`);
    }
  });

  /* ONE armed state per panel, which is all `useTwoPressConfirm` holds: a panel offering two writes
     branches the copy inside one reveal. A second beside it would arm one operation while the row
     below confirmed the other. */
  it("hold exactly one reveal and one action row each, however many writes they offer", () => {
    for (const file of PANELS) {
      const source = read(file);

      assert.equal(source.match(/<ConfirmReveal>/g)?.length, 1, `${file}: does not hold exactly one armed reveal`);
      assert.equal(source.match(/<ConfirmActionRow/g)?.length, 1, `${file}: does not hold exactly one action row`);
    }
  });

  /* The three words are the panel's own and the switching between them is the component's, so what a
     panel owes is all three — one it leaves out is a state the control cannot name. */
  it("hand the shared control every word it has to say", () => {
    for (const file of PANELS) {
      const tag = armedControl(read(file));

      // Presence rather than the braced value: three of the four are ordinarily plain strings.
      for (const word of ["resting", "armed", "running", "icon"]) {
        assert.match(tag, new RegExp(String.raw`(?<![\w-])${word}=`), `${file}: hands the shared control no \`${word}\``);
      }
    }
  });
});
