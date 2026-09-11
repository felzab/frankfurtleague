import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement } from "react";

import { blankComments } from "@/core/blankComments.ts";
import { openingTag } from "@/core/openingTag.ts";
import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest";

import { formButton } from "./formButtons";
import { PANEL_REVEAL } from "./motion";

/*
 Reached after the harness above has evaluated, which is when the JSX compile step is registered: a
 static import beside it resolves first and dies on the extension.
*/
const { ConfirmActionRow } = await import("./ConfirmActionRow.tsx");
const { ConfirmReadoutRow } = await import("./ConfirmReadoutRow.tsx");
const { ConfirmReveal } = await import("./ConfirmReveal.tsx");

/* Blanked rather than raw: `ConfirmReveal`'s JSDoc names `role="alert"` while explaining it, so a
   panel's `doesNotMatch` of that string fails it for saying so. */
const read = (file: string): string => blankComments(readFileSync(path.resolve(import.meta.dirname, file), "utf8"));

const REVEAL_SOURCE = read("ConfirmReveal.tsx");
const ACTION_ROW_SOURCE = read("ConfirmActionRow.tsx");

/** The armed shell as a panel renders it, around a child of the panel's own. */
const REVEAL = renderMarkup(ConfirmReveal, { children: createElement("p", { id: "folge" }, "Der Spielplan wird gelöscht.") });

/** The primary control the row stands its cancel beside, whose label is the panel's rather than the row's. */
const PRIMAER = createElement("button", { type: "button" }, "Ja, löschen");

const UNARMED = renderMarkup(ConfirmActionRow, { isConfirming: false, isPending: false, onCancel: () => undefined, children: PRIMAER });
const ARMED = renderMarkup(ConfirmActionRow, { isConfirming: true, isPending: false, onCancel: () => undefined, children: PRIMAER });
const IN_FLIGHT = renderMarkup(ConfirmActionRow, { isConfirming: true, isPending: true, onCancel: () => undefined, children: PRIMAER });

const READOUT = renderMarkup(ConfirmReadoutRow, { label: "Saison", value: "2026/27" });

/** The classes on the element a component renders outermost, which is the box every claim below is about. */
const wurzelKlassen = (html: string): string[] => (/^<\w+[^>]*\sclass="([^"]*)"/.exec(html)?.[1] ?? "").split(" ");

/** Every button the row renders, in document order, by the words standing on it. */
const beschriftungen = (html: string): string[] => [...html.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map((treffer) => textOf(treffer[1]!));

/** The cancel's own opening tag: it is the row's second button, the panel's control being the first. */
const abbrechen = (html: string): string => [...html.matchAll(/<button\b[^>]*>/g)][1]?.[0] ?? "";

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

type Kontrolle = { tag: string; kinder: string; von: number; bis: number };

/**
 * Every control in one source, as its opening tag and the region it branches on, and every wrapper
 * whose own press guards the control inside it rather than committing anything.
 */
function controls(source: string, file: string): { gefunden: Kontrolle[]; huellen: [number, number][] } {
  const gefunden: Kontrolle[] = [];
  const huellen: [number, number][] = [];

  for (let at = 0; ;) {
    const treffer = /<([A-Za-z][\w.]*)/.exec(source.slice(at));
    if (treffer === null) return { gefunden, huellen };

    const oeffnet = at + treffer.index;
    const name = treffer[1]!;
    const tag = openingTag(source, oeffnet);
    const benannt = CONTROL_NAME.test(name);
    // Throw rather than skip: a control this cannot read drops its whole panel out of the roster,
    // which is the silent loss a second discriminator exists to prevent.
    if (benannt && tag === "") throw new Error(`${file}: a control's opening tag could not be read`);

    if (!benannt && !(tag !== "" && PRESS.test(tag))) {
      at = oeffnet + 1;
      continue;
    }

    if (tag.endsWith("/>")) {
      // Its own attributes are the region it branches on: a control with no children rewords itself
      // through a prop, and a panel spelled that way would otherwise sit in neither roster.
      gefunden.push({ tag, kinder: tag, von: oeffnet, bis: oeffnet + tag.length });
      at = oeffnet + tag.length;
      continue;
    }

    const schliesst = source.indexOf(`</${name}>`, oeffnet);
    if (schliesst === -1) throw new Error(`${file}: a control never closes`);
    const kinder = source.slice(oeffnet + tag.length, schliesst);

    if (!benannt && CONTROL_INSIDE.test(kinder)) {
      // A press around a control guards that control rather than committing anything, so judging the
      // outer tag would read the inner one's branches against the outer one's `isDisabled`.
      huellen.push([oeffnet, oeffnet + tag.length]);
      at = oeffnet + tag.length;
      continue;
    }

    gefunden.push({ tag, kinder, von: oeffnet, bis: schliesst });
    at = schliesst + 1;
  }
}

/** The braced value of one attribute, brace-counted so a nested object or an arrow does not end it. */
function attributWert(tag: string, name: string, file: string): string {
  // Bounded on the left so `isDisabled={…}` and `aria-disabled={…}` are not read as the plain
  // spelling: a control closed by one this misses is promoted onto the roster as an arming one.
  const geschrieben = new RegExp(String.raw`(?<![\w-])` + name + String.raw`=\{`).exec(tag);
  if (geschrieben === null) return "";

  const von = tag.indexOf("{", geschrieben.index);
  let tiefe = 0;

  for (let at = von; at < tag.length; at++) {
    if (tag[at] === "{") tiefe += 1;
    else if (tag[at] === "}") {
      tiefe -= 1;
      if (tiefe === 0) return tag.slice(von + 1, at);
    }
  }

  throw new Error(`${file}: ${name} never closes`);
}

/** The `||` operands at the top level: a flag nested inside one does not close the control alone. */
function disjunkte(ausdruck: string): string[] {
  const teile: string[] = [];
  let tiefe = 0;
  let von = 0;

  for (let at = 0; at < ausdruck.length; at++) {
    const hier = ausdruck[at]!;

    if ("([{".includes(hier)) tiefe += 1;
    else if (")]}".includes(hier)) tiefe -= 1;
    else if (tiefe === 0 && hier === "|" && ausdruck[at + 1] === "|") {
      teile.push(ausdruck.slice(von, at).trim());
      at += 1;
      von = at + 1;
    }
  }

  teile.push(ausdruck.slice(von).trim());

  return teile;
}

/** A flag as a reader writes one: a bare name, or a member of the object holding the panel's state. */
const FLAG = String.raw`([A-Za-z_$][\w$]*(?:\.[\w$]+)*)`;
/** The condition of a branch wherever one stands, a reveal computed into a variable included. */
const GEZWEIGT = new RegExp(String.raw`[{=(,:]\s*!?\s*` + FLAG + String.raw`\s*(?:&&|\?)`, "g");
/** A flag handed to a component, which reveals whatever that component renders. */
const GEREICHT = new RegExp(String.raw`\b[\w-]+=\{\s*!?\s*` + FLAG + String.raw`\s*\}`, "g");

/** The identifiers a region outside every control is revealed by, gated in a brace or handed on. */
const enthuellt = (source: string): Set<string> =>
  new Set([...source.matchAll(GEZWEIGT), ...source.matchAll(GEREICHT)].map((treffer) => treffer[1]!));

const ZWEIG = new RegExp(String.raw`[{:(]\s*!?\s*` + FLAG + String.raw`\s*(?:&&|\?)`, "g");

/** The identifiers a control's children branch on, a negation and a ternary's later arms included. */
const zweige = (kinder: string): Set<string> => new Set([...kinder.matchAll(ZWEIG)].map((treffer) => treffer[1]!));

/**
 * An ARMING flag reveals a region outside the control, rewords the control that commits, and leaves
 * it pressable. The last clause parts it from a flag that only says a write is in flight, which
 * closes the control.
 */
function armsAPress(source: string, file: string): boolean {
  const { gefunden, huellen } = controls(source, file);
  // Split by code unit rather than spread by code point: every `von` and `bis` above is `indexOf`'s
  // or `length`'s, and one astral character puts a code-point array a position out from there on.
  const draussen = source.split("");
  // Blanked rather than cut out: two spans that overlap would join the text on either side of them
  // into a gate neither half holds.
  const leeren = ([von, bis]: [number, number]): void => {
    for (let at = von; at < bis; at++) if (draussen[at] !== "\n") draussen[at] = " ";
  };
  for (const { von, bis } of gefunden) leeren([von, bis]);
  for (const huelle of huellen) leeren(huelle);

  const aussen = draussen.join("");
  // A press standing here belongs to no control above — a tag whose generic argument stopped the
  // walk reading it — and a panel this reader skipped whole is in neither roster.
  if (PRESS.test(aussen)) throw new Error(`${file}: a press stands outside every control this reader can read`);

  // Read off what is left when every control is gone, so a flag branching the control's own label
  // can never stand in for the region it is supposed to reveal.
  const gates = enthuellt(aussen);

  return gefunden.some(({ tag, kinder }) => {
    // Both spellings: a native `<button>` takes `disabled`, and a submitting form whose control this
    // reads as open lands on the roster beside the panels that actually arm.
    const geschlossen = new Set([...disjunkte(attributWert(tag, "isDisabled", file)), ...disjunkte(attributWert(tag, "disabled", file))]);

    return [...zweige(kinder)].some((flag) => gates.has(flag) && !geschlossen.has(flag));
  });
}

/* What a panel IS rather than what it imports: `isConfirming` is the name the shared hook's return
   is destructured to, so a roster reading that name is the roster above under a second spelling. */
const PANELS_BY_SHAPE = named(panelsUnder(FEATURES, (source, file) => armsAPress(blankComments(source), file)));

/* Every panel in the tree arms under one name, so no count over the tree separates a reader of the
   shape from a reader of that name. These are what the tree cannot show. */
const HANDGEROLLT = [
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

const NUR_UNTERWEGS = [
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
const SCHREIBWEISEN: Record<string, string> = {
  "a control named for the press rather than the element":
    '{armed && <Alarm />}\n<PressButton isDisabled={laeuft} onPress={go}>{armed ? "Ja" : "Los"}</PressButton>',
  "a control with no Button anywhere in its name":
    '{armed && <Alarm />}\n<Pressable isDisabled={laeuft} onPress={go}>{armed ? "Ja" : "Los"}</Pressable>',
  "a Button-family control taking its press from the form":
    '{armed && <Alarm />}\n<DangerButton isDisabled={laeuft} type="submit">{armed ? "Ja" : "Los"}</DangerButton>',
  "a self-closing control taking its label as a prop":
    '{armed && <Alarm />}\n<Button isDisabled={laeuft} label={armed ? "Ja" : "Los"} onPress={go} />',
  "a reveal gated on a member of the state object":
    '{zustand.armed && <Alarm />}\n<Button isDisabled={laeuft}>{zustand.armed ? "Ja" : "Los"}</Button>',
  "a reveal handed to a component as a prop": '<Alarm isOpen={armed} />\n<Button isDisabled={laeuft}>{armed ? "Ja" : "Los"}</Button>',
  "a reveal computed into a variable the brace renders":
    'const folge = armed ? <Alarm /> : null;\n{folge}\n<Button isDisabled={laeuft}>{armed ? "Ja" : "Los"}</Button>',
};

const NATIV_UNTERWEGS = '{sendet && <Spinner />}\n<button disabled={sendet}>{sendet ? "Sendet..." : "Absenden"}</button>';

/* The reveal stands against the wrapper's own `>` or this sample cannot fail: `armsAPress` blanks by
   code-unit offsets, and a surrogate pair above the span moves what it blanks onto that reveal. */
const umhuelltHinter = (kopf: string): string =>
  `${kopf}<div onPress={guard}>{armed && <Alarm />}<Button isDisabled={laeuft} onPress={go}>{armed ? "Ja" : "Los"}</Button></div>`;

describe("the shape the second roster reads", () => {
  /* The failure the pair exists to catch: a panel that arms without importing the hook. Its flag is
     spelled differently on purpose — the shared spelling is the one both routes already share. */
  it("finds a panel arming its own state under a name of its own", () => {
    assert.ok(!HANDGEROLLT.includes("useTwoPressConfirm(") && !HANDGEROLLT.includes("isConfirming"), "the sample takes the shared spelling");
    assert.ok(
      armsAPress(blankComments(HANDGEROLLT), "handgerollt"),
      "a panel arming its own state under its own name is absent from the roster",
    );
  });

  it("finds a panel arming a press however its control and its reveal are spelled", () => {
    for (const [was, quelle] of Object.entries(SCHREIBWEISEN)) {
      assert.ok(armsAPress(blankComments(quelle), was), `${was}: absent from the roster`);
    }
  });

  it("finds a panel whose own copy carries an astral character", () => {
    assert.ok(
      armsAPress(blankComments(umhuelltHinter("<p>Postfach</p>\n")), "ohne"),
      "the sample is off the roster with no glyph in it at all",
    );
    assert.ok(
      armsAPress(blankComments(umhuelltHinter("<p>Postfach \u{1F4EC}</p>\n")), "mit"),
      "one emoji in a panel's copy drops that panel out of the roster",
    );
  });

  /* A flag saying the write is in flight reveals a region and rewords the control exactly as an
     arming one does, so a reader taking those two alone puts every submitting form on the roster. */
  it("passes over a control that only closes while its write is in flight", () => {
    assert.ok(!armsAPress(blankComments(NUR_UNTERWEGS), "unterwegs"), "a form that only reports its own request is on the roster");
  });

  /* `isDisabled` is HeroUI's spelling and a native control takes `disabled`, so a reader holding
     only the first reads an ordinary submitting form as one that escalates. */
  it("passes over a native button closed by the plain `disabled` spelling", () => {
    assert.ok(!armsAPress(blankComments(NATIV_UNTERWEGS), "nativ"), "a native control closing on its own request is on the roster");
  });

  /* A control the reader cannot parse would otherwise leave its panel out of the population, where a
     missing member reads as agreement between the two routes. */
  it("fails on a control it cannot read rather than dropping its panel", () => {
    assert.throws(() => armsAPress("<Button isDisabled={x}>{y ? 1 : 2}", "offen"), /never closes/);
    assert.throws(() => armsAPress("<Button title={x}<div></Button>", "wirr"), /could not be read/);
  });

  /* The residue of the walk above, on a tag whose name is no control's: a lost brace count stops the
     tag being read, and a press on such a tag belongs to a control this reader never judged. */
  it("fails on a press it could not place rather than passing the file over", () => {
    assert.throws(
      () => armsAPress("<Pressable title={x}<div> onPress={() => go()}>{armed ? 1 : 2}</Pressable>", "unlesbar"),
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
    for (const token of PANEL_REVEAL.split(" ")) {
      assert.ok(wurzelKlassen(REVEAL).includes(token), `the reveal is missing ${token}, which the shared token carries`);
    }

    assert.equal(wurzelKlassen(REVEAL).filter((token) => token === "animate-in").length, 1, "the reveal wears a second entry animation");
    // A literal spelling the same classes renders identically, so which of the two stands here is
    // legible in the source alone.
    assert.match(REVEAL_SOURCE, /\$\{PANEL_REVEAL\}/, "the reveal spells its motion beside the vocabulary the app keeps");
  });

  /* One gap for every panel on the roster. A prop here would be a variant prop under another name,
     which `docs/frontend/spec.md :: I67` refuses for exactly this shape. */
  it("takes no variant of any kind", () => {
    for (const token of ["flex", "flex-col", "gap-4"]) {
      assert.ok(wurzelKlassen(REVEAL).includes(token), `the reveal is missing ${token}, so its gap is no longer one decision`);
    }

    // A knob nobody has passed yet changes nothing it renders, so the declaration is where one shows.
    assert.doesNotMatch(REVEAL_SOURCE, /\bvariant\b|\bgap\?:|\btone\b/, "the shell grew a knob");
  });
});

describe("the armed action row", () => {
  /* A standing „Abbrechen“ beside an unarmed control offers to cancel nothing, so the cancel is the
     armed state's and stands after the control it cancels. */
  it("renders the cancel with the armed state and never before it", () => {
    assert.deepEqual(beschriftungen(UNARMED), ["Ja, löschen"], "an unarmed row offers to cancel a press nobody has made");
    assert.deepEqual(beschriftungen(ARMED), ["Ja, löschen", "Abbrechen"], "the armed row does not stand its cancel beside the control");
  });

  /* Closed rather than taken away: a control vanishing mid-press reflows the row under the pointer,
     and a second cancel during the request would disarm a write already sent. */
  it("closes the cancel while the write is in flight", () => {
    assert.deepEqual(beschriftungen(IN_FLIGHT), ["Ja, löschen", "Abbrechen"], "the cancel leaves the row mid-press");
    assert.match(abbrechen(IN_FLIGHT), /\sdisabled=""/, "the cancel stays pressable while the write it would disarm is in flight");
    assert.doesNotMatch(abbrechen(ARMED), /\sdisabled=""/, "the cancel is closed before there is anything in flight");
  });

  /* The app's one cancel treatment, at the width a column asks for. Spell the classes here and this
     row drifts from every other form's pair the first time `formButton` moves. */
  it("takes the cancel's fill and its column width from the shared intent", () => {
    const getragen = (abbrechen(ARMED).match(/\sclass="([^"]*)"/)?.[1] ?? "").split(" ");

    for (const token of formButton({ intent: "cancel", stacks: true }).split(" ")) {
      assert.ok(getragen.includes(token), `the cancel is missing ${token}, which the shared recipe emits`);
    }

    // Two recipes emitting the same classes render alike, so a copy is legible in the source alone.
    assert.match(ACTION_ROW_SOURCE, /formButton\(\{ intent: "cancel", stacks: true \}\)/, "the cancel is dressed beside the shared recipe");
  });

  /* A row wherever a pair looks uncramped, a column of FULL-WIDTH buttons where it does not — never
     a column of narrow ones. The width is the recipe's, above; the direction is the box's. */
  it("stands its buttons in a column below `sm`", () => {
    const klassen = wurzelKlassen(ARMED);

    assert.ok(klassen.includes("flex-col") && klassen.includes("sm:flex-row"), "the row is not a column below `sm`");
    // Every centring class rather than the scoped one's presence: `sm:items-center` is still there
    // with an unscoped one beside it, which is the shape this refuses.
    assert.deepEqual(
      klassen.filter((token) => token.endsWith("items-center")),
      ["sm:items-center"],
      "the row's centring is no longer exactly the `sm:`-scoped one",
    );
  });
});

describe("the readout row", () => {
  /* A `<dt>`/`<dd>` pair and not two spans: the pair is what makes the value a fact about the label
     rather than two strings sharing a line. */
  it("renders its label and value as a description pair", () => {
    assert.match(READOUT, /<dt[^>]*>Saison<\/dt><dd[^>]*>2026\/27<\/dd>/, "the readout is two strings sharing a line");
  });
});

/** The panels a second discriminator finds, for comparison against the sweep above. */
/* Renamed OR taken by shorthand: requiring `isPending: x` made the guard unreadable for a panel that
   destructures plainly, which is a spelling most panels do not use. */
// `const {` and no `;` inside: a bare `\{` matched from an earlier statement's brace and read a span
// of unrelated code as the destructuring.
function pendingFlag(source: string): string | null {
  const destructured = /const \{([^};]*)\}\s*=\s*useTwoPressConfirm\(/.exec(source);

  if (destructured === null) return null;
  const namen = destructured[1]!;
  const umbenannt = /isPending:\s*(\w+)/.exec(namen);
  return umbenannt !== null ? umbenannt[1]! : namen.includes("isPending") ? "isPending" : null;
}

// Backwards from the armed fill to the element wearing it: a panel may render other buttons, and
// `FormSaisonSection` does.
function armedControl(source: string): { tag: string; kinder: string } {
  const graded = source.indexOf("confirmButton(isConfirming)");
  const opens = source.lastIndexOf("<Button", graded);
  const tag = openingTag(source, opens);

  return { tag, kinder: source.slice(opens + tag.length, source.indexOf("</Button>", opens)) };
}

function panelsMatching(needle: string): string[] {
  return PANELS.filter((file) => read(file).includes(needle));
}

describe("every panel that escalates a press", () => {
  /* The whole point of the extraction. A panel spelling the shell again is one that drifts from the
     rest the next time any of the three shared components moves. */
  it("render the shared mechanism rather than spelling their own", () => {
    // The reveal and the fill are filters of this roster, so they catch a panel spelling its own
    // shell and never one the hook import left out of the walk. `PANELS_BY_SHAPE` is the route that
    // catches that.
    const byReveal = panelsMatching("<ConfirmReveal>");
    const byFill = panelsMatching("confirmButton(isConfirming)");

    assert.ok(PANELS.length > 0, "the sweep found no panels at all, so every case below passes over nothing");
    assert.deepEqual(PANELS, PANELS_BY_SHAPE, "a panel arms a press without taking the shared hook, or the reverse");
    assert.deepEqual(PANELS, byReveal, "a panel renders the shared reveal without the shared armed state, or the reverse");
    assert.deepEqual(PANELS, byFill, "a panel wears the shared armed fill without the shared armed state, or the reverse");

    for (const file of PANELS) {
      const source = read(file);

      assert.match(source, /<ConfirmReveal>/, `${file}: does not render the shared reveal`);
      assert.match(source, /<ConfirmActionRow/, `${file}: does not render the shared action row`);
      assert.match(source, /confirmButton\(isConfirming\)/, `${file}: grades its own armed fill`);
      assert.doesNotMatch(source, /role="alert"/, `${file}: spells its own alert`);
      assert.doesNotMatch(source, /Bist Du Dir sicher/, `${file}: spells its own announcement`);
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

  /* Over the set because the gap was per panel: a primary control left open during its own request
     sends the write a second time. The row's own half — the closed cancel — is asserted on the
     shell, above. */
  it("close their primary control while its own request is in flight", () => {
    for (const file of PANELS) {
      const source = read(file);
      const flag = pendingFlag(source);

      assert.ok(flag !== null, `${file}: takes no pending flag from the shared hook`);

      const row = openingTag(source, source.indexOf("<ConfirmActionRow"));
      assert.ok(row.includes(`isPending={${flag}}`), `${file}: the shared row never learns the write is in flight`);

      const { tag } = armedControl(source);

      assert.ok(tag.length > 0, `${file}: no opening tag around the armed control`);
      // Split on the non-word runs so a flag never matches inside a longer name.
      const bedingung = tag.split("isDisabled={")[1]?.split("}")[0] ?? "";

      assert.ok(bedingung.split(/[^A-Za-z0-9_]+/).includes(flag), `${file}: a second press during the request sends a second write`);
    }
  });

  /* Both axes read the armed control's children with the whitespace collapsed: `isDisabled` names the
     flag in the opening tag, and a panel is free to wrap its glyph in a second ternary. */
  it("drop the glyph and name the request while it is in flight", () => {
    for (const file of PANELS) {
      const source = read(file);
      const dicht = armedControl(read(file)).kinder.replace(/\s+/g, "");

      // The glyph announces the press; step two announces itself in words, so the two together read
      // as one control saying the same thing twice.
      assert.ok(dicht.includes("!isConfirming&&"), `${file}: keeps its glyph while armed`);
      // A label that never changes leaves a pressed control looking unpressed for the whole request.
      assert.ok(dicht.includes(`${pendingFlag(source)}?`), `${file}: never says the request is in flight`);
    }
  });
});
