import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Source text with every comment blanked first. `ConfirmReveal`'s JSDoc names `role="alert"` while
 * explaining it, so a raw match survives the attribute's deletion — and a panel's `doesNotMatch` of
 * the same string fails it for saying so.
 */
function code(source: string): string {
  const out = [...source];
  const blank = (from: number, to: number): void => {
    for (let at = from; at < to; at++) if (out[at] !== "\n") out[at] = " ";
  };

  for (let at = 0; at < source.length; at++) {
    const here = source.slice(at, at + 2);

    if (here === "//" || here === "/*") {
      const ends = here === "//" ? source.indexOf("\n", at) : source.indexOf("*/", at + 2);
      const to = ends === -1 ? source.length : here === "//" ? ends : ends + 2;
      blank(at, to);
      at = to - 1;
      continue;
    }

    // Skipped whole rather than scanned: a `//` inside a URL or a class list would otherwise blank
    // the rest of its line. Comments are consumed above first, so an apostrophe inside one is safe.
    const quote = source[at];
    if (quote === '"' || quote === "'" || quote === "`") {
      for (at += 1; at < source.length; at++) {
        if (source[at] === "\\") {
          at += 1;
          continue;
        }
        if (source[at] === quote) break;
      }
    }
  }

  return out.join("");
}

const read = (file: string): string => code(readFileSync(path.resolve(import.meta.dirname, file), "utf8"));

const REVEAL = read("ConfirmReveal.tsx");
const ACTION_ROW = read("ConfirmActionRow.tsx");
const READOUT_ROW = read("ConfirmReadoutRow.tsx");

/** Every panel that escalates a press in place. Each renders the shell rather than spelling one. */
/**
 * Every panel that escalates a press, DISCOVERED rather than typed.
 *
 * A roster counted against its own length can never report an omission.
 * `useTwoPressConfirm` is the discriminator because it IS the shape.
 */
function panelsUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return panelsUnder(full);

    return entry.name.endsWith(".tsx") && readFileSync(full, "utf8").includes("useTwoPressConfirm(") ? [full] : [];
  });
}

const PANELS = panelsUnder(path.resolve(import.meta.dirname, "..", "..", "..", "features")).map((file) =>
  path
    .relative(import.meta.dirname, file)
    .split(path.sep)
    .join("/"),
);

/**
 * One JSX opening tag, from `<Name` to the `>` that closes it. Braces are counted, so a `>` inside an
 * attribute expression — an arrow, a comparison, a class list — does not end the tag early.
 */
function openingTag(source: string, from: number): string {
  let depth = 0;

  for (let at = from; at < source.length; at++) {
    const here = source[at];
    if (here === "{") depth += 1;
    else if (here === "}") depth -= 1;
    else if (here === ">" && depth === 0) return source.slice(from, at + 1);
  }

  return "";
}

describe("the source these files are read as", () => {
  /* First, and over cases rather than the files: a stripper that quietly stopped removing anything
     would put every negative case below back to passing over a comment, and every positive one back
     to passing off a JSDoc. */
  it("blanks every comment form and leaves the code beside them", () => {
    for (const comment of ['/** role="alert" */', '// role="alert"', '{/* role="alert" */}']) {
      assert.doesNotMatch(code(comment), /role="alert"/, `${comment}: survived the stripper`);
    }

    assert.match(code('<div role="alert">'), /role="alert"/, "the attribute did not survive the stripper");
    assert.match(code('href="https://x.test" role="alert"'), /role="alert"/, "a URL inside a string ate the code after it");
    assert.match(code('const label = "a // b"; role="alert"'), /role="alert"/, "a comment marker inside a string ate the code after it");
  });
});

describe("the armed reveal", () => {
  /* The one mechanism every escalating panel shares. Without it the only signal that the next press became
     irreversible is the button label quietly changing, which no assistive technology announces. */
  it("announces itself as an alert and says so in words", () => {
    assert.match(REVEAL, /role="alert"/);
    assert.match(REVEAL, /Bist Du Dir sicher\?/);
  });

  /* Tier 3, a section unfolding inside a page already in view — spelled as the shared token so the
     app's one motion vocabulary reaches it, and so reduced motion reaches it too. */
  it("reveals through the shared motion token rather than its own classes", () => {
    assert.match(REVEAL, /\$\{PANEL_REVEAL\}/);
    assert.doesNotMatch(REVEAL, /animate-in/, "the reveal spells a motion class beside the token");
  });

  /* One gap for every panel on the roster. A prop here would be a variant prop under another name, which
     `docs/frontend/spec.md :: I37` refuses for exactly this shape. */
  it("takes no variant of any kind", () => {
    assert.match(REVEAL, /flex flex-col gap-4/);
    assert.doesNotMatch(REVEAL, /\bvariant\b|\bgap\?:|\btone\b/, "the shell grew a knob");
  });
});

describe("the armed action row", () => {
  /* A standing „Abbrechen“ beside an unarmed control offers to cancel nothing, so the cancel is the
     armed state's and appears with it. */
  it("renders the cancel with the armed state and never before it", () => {
    assert.match(ACTION_ROW, /\{isConfirming && \(/);
    assert.match(ACTION_ROW, /Abbrechen/);
  });

  /* Closed rather than hidden: a control vanishing mid-press reflows the row under the pointer, and
     a second cancel during the request would disarm a write already sent. */
  it("closes the cancel while the write is in flight", () => {
    assert.match(ACTION_ROW, /isDisabled=\{isPending\}/);
  });

  /* The app's one cancel treatment. Spell the classes here and this row drifts from every other
     form's pair the first time `formButton` moves. */
  it("takes the cancel's fill from the shared intent", () => {
    assert.match(ACTION_ROW, /formButton\(\{ intent: "cancel"/);
  });

  /* A row wherever a pair looks uncramped, a column of FULL-WIDTH buttons where it does not — never
     a column of narrow ones. `stacks` reaches the buttons and the direction the box: either alone
     leaves the shape this removes. */
  it("stands its buttons in a full-width column below `sm`", () => {
    assert.match(ACTION_ROW, /flex-col[^"]*\bsm:flex-row\b/, "the row is not a column below `sm`");
    // Every centring class rather than the scoped one's presence: `sm:items-center` still matches with
    // an unscoped one added beside it, which is the shape this refuses.
    assert.deepEqual(
      [...ACTION_ROW.matchAll(/[\w:-]*items-center/g)].map((found) => found[0]),
      ["sm:items-center"],
      "the row's centring is no longer exactly the `sm:`-scoped one",
    );
    assert.match(ACTION_ROW, /formButton\(\{ intent: "cancel", stacks: true \}\)/, "the cancel does not fill the column it stands in");
  });
});

describe("the readout row", () => {
  /* A `<dt>`/`<dd>` pair and not two spans: the pair is what makes the value a fact about the label
     rather than two strings sharing a line. */
  it("renders a description pair", () => {
    assert.match(READOUT_ROW, /<dt /);
    assert.match(READOUT_ROW, /<dd /);
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
    // Against the OTHER two discriminators, never against its own length: a roster counted against
    // itself reports every omission as a pass.
    const byReveal = panelsMatching("<ConfirmReveal>");
    const byFill = panelsMatching("confirmButton(isConfirming)");

    assert.ok(PANELS.length > 0, "the sweep found no panels at all, so every case below passes over nothing");
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
