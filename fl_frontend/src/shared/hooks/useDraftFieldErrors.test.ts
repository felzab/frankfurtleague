import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";
import { z } from "zod";

// Relative imports, not the "@/" alias: Node's resolver does not read tsconfig paths.
import {
  applyVerdicts,
  differsFromSubmitted,
  forgivenVerdicts,
  mergeFieldVerdicts,
  missingVerdicts,
  submitDecision,
  submitRefusals,
  verdictMessage,
} from "./useDraftFieldErrors.ts";

import type { FieldVerdicts } from "./useDraftFieldErrors.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..");

/** The German sentence a Spieltag occupancy refusal puts on a side — a rule only the server holds. */
const SERVER_REFUSAL = "Dieses Team spielt am selben Spieltag schon in einem anderen Spiel.";

/** What a payload schema says about an emptied count, which is all a client verdict can ever know. */
const CLIENT_MESSAGE = "Bitte gib die Treffer von Team 1 ein.";

/** What the club schema says about a one-character Kürzel. */
const CLIENT_SHORTHAND = "Das Kürzel besteht aus genau 2 Zeichen.";

/** A verdict about a value the submit already judged. */
const onSameValue = (message: string | null) => ({ message, differs: false });

/** A verdict about a value that has moved since the submit judged it. */
const onMovedValue = (message: string | null) => ({ message, differs: true });

describe("differsFromSubmitted", () => {
  it("calls a path differing when no submit has been recorded for the schema", () => {
    // Nothing has been said about the draft, so there is no verdict to be superseded by.
    assert.equal(differsFromSubmitted(undefined, { datum: "2026-08-19" }, ["datum"]), true);
  });

  it("calls a blur that changed nothing the same value", () => {
    const submitted = { datum: "2026-08-19", ort: { mietpreis: 50 } };

    assert.equal(differsFromSubmitted(submitted, { datum: "2026-08-19", ort: { mietpreis: 50 } }, ["datum"]), false);
  });

  it("resolves a dotted path into the draft", () => {
    const submitted = { ort: { spielort_id: "a", mietpreis: 50 } };

    assert.equal(differsFromSubmitted(submitted, { ort: { spielort_id: "a", mietpreis: null } }, ["ort.mietpreis"]), true);
  });

  it("calls the whole call differing when any one of its paths moved", () => {
    // The cross-field case: the level-shoot-out refine reports on `team2` whichever count was edited,
    // so editing `team1` has to unlock the verdict sitting on `team2`.
    const submitted = { elfmeterschiessen: { team1: 3, team2: 3 } };
    const draft = { elfmeterschiessen: { team1: 4, team2: 3 } };

    assert.equal(differsFromSubmitted(submitted, draft, ["elfmeterschiessen.team1", "elfmeterschiessen.team2"]), true);
  });

  it("compares structurally rather than by identity", () => {
    const submitted = { team1: { team_id: "a", tore: null } };

    assert.equal(differsFromSubmitted(submitted, { team1: { team_id: "a", tore: null } }, ["team1"]), false);
  });

  it("reads a path through a null as absent rather than throwing", () => {
    assert.equal(differsFromSubmitted({ ort: null }, { ort: null }, ["ort.mietpreis"]), false);
  });
});

/** What a schema reports for a whole draft, keyed the way `toFieldErrors` keys it. */
const FOUND = {
  strasse: "Bitte gib eine Straße ein.",
  shorthand: "Das Kürzel besteht aus genau 2 Zeichen.",
  telefon: "Bitte gib eine gültige Telefonnummer ein.",
  schulform: "Bitte wähle eine Schulform.",
  "rules.erlaubte_stufen": "Bitte wähle mindestens eine Stufe.",
  "einwilligung.erteilt": "Bitte stimme der Verarbeitung zu.",
  "kader.groesse": "Ein Kader hat mindestens einen Spieler.",
  "kontakte.trainer.erteilt": "Bitte stimme der Verarbeitung zu.",
  "kontakte.ansprechperson.erteilt": "Bitte stimme der Verarbeitung zu.",
  "kontakte.stellvertretung.erteilt": "Bitte stimme der Verarbeitung zu.",
  "austritt.datum": "Bitte gib ein gültiges Datum ein.",
};

describe("verdictMessage", () => {
  it("publishes the schema's message for a value that is there and wrong", () => {
    // Two characters are required, one was typed.
    assert.equal(verdictMessage(FOUND, { shorthand: "A" }, "shorthand"), "Das Kürzel besteht aus genau 2 Zeichen.");
  });

  it("says nothing about an empty field before send has been pressed", () => {
    // Focusing a field and leaving it must never paint it, and neither must clearing one.
    assert.equal(verdictMessage(FOUND, { strasse: "" }, "strasse"), null);
  });

  it("says nothing about a consent switch left off, which is missing rather than wrong", () => {
    // An unchecked required box is `valueMissing` to the browser, so `false` is an absence.
    assert.equal(verdictMessage(FOUND, { einwilligung: { erteilt: false } }, "einwilligung.erteilt"), null);
  });

  it("names the missing value once send has been pressed", () => {
    // `aria` validation refuses nothing natively, so this message is the field's only voice.
    assert.equal(verdictMessage(FOUND, { strasse: "" }, "strasse", { afterSubmit: true }), "Bitte gib eine Straße ein.");
  });

  it("still judges a zero, which is a number somebody typed rather than an absence", () => {
    assert.equal(verdictMessage(FOUND, { kader: { groesse: 0 } }, "kader.groesse"), "Ein Kader hat mindestens einen Spieler.");
  });

  it("still judges an empty array, which is a made choice rather than an absence", () => {
    assert.equal(verdictMessage(FOUND, { rules: { erlaubte_stufen: [] } }, "rules.erlaubte_stufen"), "Bitte wähle mindestens eine Stufe.");
  });

  it("is what the hook publishes through, and not a routine standing beside it", () => {
    // The cases above grade the decision; this one grades the WIRING, which no assertion here can
    // execute. Without it, deleting the call leaves every case above passing.
    const source = readFileSync(path.join(import.meta.dirname, "useDraftFieldErrors.ts"), "utf8");

    assert.match(source, /verdictMessage\(found, draft, path, \{ afterSubmit: hasAttemptedSubmit \}\)/);
  });
});

describe("mergeFieldVerdicts", () => {
  it("keeps a submit's message when the blur that followed changed nothing", () => {
    // The whole bug. `reportValidity()` moves focus INTO the refused field, so the admin's next Tab
    // records a `null` on it — newer than the refusal, and about the very value it refused.
    const verdicts: FieldVerdicts = { datum: onSameValue(null) };

    assert.deepEqual(mergeFieldVerdicts({ datum: SERVER_REFUSAL }, verdicts), { datum: SERVER_REFUSAL });
  });

  it("lets a verdict on a changed value retract the submit's message", () => {
    // The behaviour the retraction exists for: the admin picked another team, so the refusal is stale.
    const verdicts: FieldVerdicts = { "team1.team_id": onMovedValue(null) };

    assert.deepEqual(mergeFieldVerdicts({ "team1.team_id": SERVER_REFUSAL }, verdicts), {});
  });

  it("refuses a same-value non-null verdict the same way it refuses a same-value null", () => {
    // The symmetry: overwriting the server's reason with a browser guess loses as much as deleting it.
    const verdicts: FieldVerdicts = { "elfmeterschiessen.team1": onSameValue(CLIENT_MESSAGE) };

    assert.deepEqual(mergeFieldVerdicts({ "elfmeterschiessen.team1": SERVER_REFUSAL }, verdicts), {
      "elfmeterschiessen.team1": SERVER_REFUSAL,
    });
  });

  it("lets a verdict on a changed value overwrite the submit's message", () => {
    const verdicts: FieldVerdicts = { "elfmeterschiessen.team1": onMovedValue(CLIENT_MESSAGE) };

    assert.deepEqual(mergeFieldVerdicts({ "elfmeterschiessen.team1": SERVER_REFUSAL }, verdicts), {
      "elfmeterschiessen.team1": CLIENT_MESSAGE,
    });
  });

  it("unlocks every path of a call where a sibling path moved", () => {
    // `differs` is decided per CALL, so the shoot-out's two counts carry the same answer — which is
    // what lets an edit to `team1` clear the level-shoot-out message the schema puts on `team2`.
    const verdicts: FieldVerdicts = {
      "elfmeterschiessen.team1": onMovedValue(null),
      "elfmeterschiessen.team2": onMovedValue(null),
    };

    assert.deepEqual(mergeFieldVerdicts({ "elfmeterschiessen.team2": SERVER_REFUSAL }, verdicts), {});
  });

  it("shows a verdict on a path the submit did not name", () => {
    // Nothing is being rewritten there, so eager validation survives a failed submit on other fields.
    const verdicts: FieldVerdicts = { "ort.mietpreis": onSameValue(CLIENT_MESSAGE) };

    assert.deepEqual(mergeFieldVerdicts({ "team1.team_id": SERVER_REFUSAL }, verdicts), {
      "team1.team_id": SERVER_REFUSAL,
      "ort.mietpreis": CLIENT_MESSAGE,
    });
  });

  it("drops a null verdict on a path the submit did not name", () => {
    assert.deepEqual(mergeFieldVerdicts({}, { "ort.mietpreis": onSameValue(null) }), {});
  });

  it("grades each schema's paths against that schema's own submitted payload", () => {
    // The two-schema editors: the person half and the season half publish into one verdict store, and
    // each verdict carries the answer its own schema's payload produced.
    const verdicts: FieldVerdicts = {
      vorname: onSameValue(null),
      "membership.nummer": onMovedValue(null),
    };

    assert.deepEqual(mergeFieldVerdicts({ vorname: SERVER_REFUSAL, "membership.nummer": SERVER_REFUSAL }, verdicts), {
      vorname: SERVER_REFUSAL,
    });
  });

  it("leaves the submit's map untouched", () => {
    // The merge is read while rendering, and mutating either store from there would make a verdict
    // write into the map that moves focus (`docs/frontend/spec.md` I19).
    const submitErrors = { "team1.team_id": SERVER_REFUSAL };
    mergeFieldVerdicts(submitErrors, { "team1.team_id": onMovedValue(null) });

    assert.deepEqual(submitErrors, { "team1.team_id": SERVER_REFUSAL });
  });
});

/** The club half of the team editor, which is where the Kürzel refusal lands. */
const TEAM_SCHEMA = z.object({
  shorthand: z.string().length(2, { error: "Das Kürzel besteht aus genau 2 Zeichen." }),
  full_name: z.string().nonempty({ error: "Bitte gib den vollständigen Namen ein." }),
});

const forgive = (shown: Record<string, string>, payload: unknown, submitted?: unknown) =>
  forgivenVerdicts({
    shown,
    payloads: { team: payload },
    schemas: { team: TEAM_SCHEMA },
    submitted: submitted === undefined ? {} : { team: submitted },
    afterSubmit: false,
  });

describe("forgivenVerdicts", () => {
  it("retracts a client message the moment the value becomes valid", () => {
    // The forgiving half: "A" was refused on blur, and "AB" must clear it without waiting for another.
    assert.deepEqual(forgive({ shorthand: CLIENT_SHORTHAND }, { shorthand: "AB", full_name: "FC Beispiel" }), {
      shorthand: { message: null, differs: true },
    });
  });

  it("leaves a message that is still wrong exactly as it stands", () => {
    // Never an overwrite: replacing one message with another mid-word is a message APPEARING between
    // keystrokes, which `.claude/rules/frontend.md` forbids. Only the retraction is allowed here.
    assert.equal(forgive({ shorthand: CLIENT_SHORTHAND }, { shorthand: "A", full_name: "FC Beispiel" }), null);
  });

  it("never speaks about a path showing nothing, however wrong that path is", () => {
    // The whole asymmetry. `shorthand` is refused by the schema here and still says nothing, because a
    // half-typed value has not earned its first message.
    assert.equal(forgive({}, { shorthand: "A", full_name: "" }), null);
  });

  it("marks a retraction on an UNTOUCHED path as not differing, so a server refusal survives", () => {
    // The Kürzel refusal: the admin is typing in `full_name`, and uniqueness is a rule only the server
    // holds — the schema is happy with "FC", so without `differs` this would delete the refusal.
    const submitted = { shorthand: "FC", full_name: "FC Beispiel" };
    const retracted = forgive({ shorthand: SERVER_REFUSAL }, { shorthand: "FC", full_name: "FC Beispiel eV" }, submitted);

    assert.deepEqual(retracted, { shorthand: { message: null, differs: false } });
    // And the merge is what acts on it: the refusal stands because the value beneath it never moved.
    assert.deepEqual(mergeFieldVerdicts({ shorthand: SERVER_REFUSAL }, retracted ?? {}), { shorthand: SERVER_REFUSAL });
  });

  it("grades each shown path against ITS OWN value, not against whether anything moved", () => {
    // The discriminator a single-path case cannot draw: with `differs` per CALL, the retyped `full_name`
    // marks the untouched `shorthand` moved too and deletes a refusal nobody answered.
    const submitted = { shorthand: "FC", full_name: "FC Beispiel" };
    const shown = { shorthand: SERVER_REFUSAL, full_name: "Dieser Name ist vergeben." };
    const retracted = forgive(shown, { shorthand: "FC", full_name: "FC Beispiel eV" }, submitted);

    assert.deepEqual(retracted, {
      shorthand: { message: null, differs: false },
      full_name: { message: null, differs: true },
    });
    assert.deepEqual(mergeFieldVerdicts(shown, retracted ?? {}), { shorthand: SERVER_REFUSAL });
  });

  it("retracts a server refusal once the refused value itself is retyped", () => {
    // The other direction, and the one that must NOT be blocked: the refusal was about "FC".
    const submitted = { shorthand: "FC", full_name: "FC Beispiel" };
    const retracted = forgive({ shorthand: SERVER_REFUSAL }, { shorthand: "FD", full_name: "FC Beispiel" }, submitted);

    assert.deepEqual(retracted, { shorthand: { message: null, differs: true } });
    assert.deepEqual(mergeFieldVerdicts({ shorthand: SERVER_REFUSAL }, retracted ?? {}), {});
  });

  it("lets only a schema whose payload spells the path answer for it", () => {
    // A two-schema editor: the club payload says nothing about `gruppe`, so its silence must not be
    // mistaken for approval of the season half's message.
    const retracted = forgivenVerdicts({
      shown: { gruppe: "Bitte wähle eine Gruppe." },
      payloads: { team: { shorthand: "FC", full_name: "FC Beispiel" } },
      schemas: { team: TEAM_SCHEMA },
      submitted: {},
      afterSubmit: false,
    });

    assert.equal(retracted, null);
  });
});

/** A schema with one required date and one required text field, which is the whole of the exception's shape. */
const AUSTRITT_SCHEMA = z.object({
  grund: z.string().nonempty({ error: "Bitte gib einen Grund ein." }),
  datum: z.string().nonempty({ error: "Bitte gib ein gültiges Datum ein." }),
});

const sweep = (payload: unknown, submitted?: unknown) =>
  missingVerdicts({
    payloads: { austritt: payload },
    schemas: { austritt: AUSTRITT_SCHEMA },
    submitted: submitted === undefined ? {} : { austritt: submitted },
  });

describe("missingVerdicts", () => {
  it("names every missing field, whatever kind of control holds it", () => {
    // `aria` validation refuses nothing, so a date and a text field are owed the same sentence.
    assert.deepEqual(sweep({ grund: "", datum: "" }), {
      grund: { message: "Bitte gib einen Grund ein.", differs: true },
      datum: { message: "Bitte gib ein gültiges Datum ein.", differs: true },
    });
  });

  it("says nothing at all once every field is filled in", () => {
    assert.equal(sweep({ grund: "Rückzug", datum: "2026-08-19" }), null);
  });

  it("never speaks for a value that is present and wrong", () => {
    // That message reaches the field through `validatePaths`. Publishing it here too would put one on
    // every field at once, which is the sea of red this all started with.
    const wrong = z.object({ datum: z.string().length(10, { error: "Bitte gib ein gültiges Datum ein." }) });
    const out = missingVerdicts({ payloads: { austritt: { datum: "x" } }, schemas: { austritt: wrong }, submitted: {} });

    assert.equal(out, null);
  });

  it("marks an unmoved value as not differing, so a server refusal on it still stands", () => {
    const submitted = { grund: "", datum: "" };

    assert.deepEqual(sweep({ grund: "", datum: "" }, submitted), {
      grund: { message: "Bitte gib einen Grund ein.", differs: false },
      datum: { message: "Bitte gib ein gültiges Datum ein.", differs: false },
    });
  });
});

describe("submitRefusals", () => {
  it("says nothing about a draft every schema accepts", () => {
    const clean = submitRefusals({ payloads: { team: { shorthand: "FC", full_name: "FC Beispiel" } }, schemas: { team: TEAM_SCHEMA } });

    assert.deepEqual(clean, {});
  });

  it("names an empty required field, which is what the browser stopped doing under `aria`", () => {
    const refusals = submitRefusals({ payloads: { team: { shorthand: "", full_name: "" } }, schemas: { team: TEAM_SCHEMA } });

    assert.deepEqual(refusals, {
      shorthand: "Das Kürzel besteht aus genau 2 Zeichen.",
      full_name: "Bitte gib den vollständigen Namen ein.",
    });
  });

  it("merges the halves a two-schema press writes", () => {
    const refusals = submitRefusals({
      payloads: { team: { shorthand: "", full_name: "FC Beispiel" }, austritt: { grund: "", datum: "" } },
      schemas: { team: TEAM_SCHEMA, austritt: AUSTRITT_SCHEMA },
    });

    assert.deepEqual(Object.keys(refusals).sort(), ["datum", "grund", "shorthand"]);
  });

  it("blocks on a single refusal, which is the boundary a `> 1` slip would move", () => {
    // M17's shape, as a PROPERTY rather than a pinned literal: one refused field is already a blocked
    // submit, so an off-by-one in the emptiness test changes this answer rather than only this text.
    const one = submitDecision({ payloads: { team: { shorthand: "AB", full_name: "" } }, schemas: { team: TEAM_SCHEMA } });

    assert.deepEqual(one, { blocked: true, refusals: { full_name: "Bitte gib den vollständigen Namen ein." } });
  });

  it("lets a clean draft through, naming no case the caller has to interpret", () => {
    const clean = submitDecision({ payloads: { team: { shorthand: "FC", full_name: "FC Beispiel" } }, schemas: { team: TEAM_SCHEMA } });

    assert.deepEqual(clean, { blocked: false });
  });

  it("hands the write to the guard rather than answering whether one may run", () => {
    // The TYPE is the guard: `guardSubmit` returns `void` and takes the write, so an ignored answer is a
    // compile error at every call site. This pins only what the signature cannot say.
    const source = readFileSync(path.join(import.meta.dirname, "useDraftFieldErrors.ts"), "utf8");
    const BLOCK = ["    if (decision.blocked) {", "      setSubmitFieldErrors(decision.refusals, payloads);"].join("\n");

    assert.ok(source.includes(BLOCK), "the block no longer publishes its refusals");
    // Marked AND announced: a `FieldError` sits in no live region, so a blocked press is silent without this.
    assert.match(source, /appToast[.]danger[(]BLOCKED_SUBMIT_TITLE/, "a blocked submit stopped announcing itself");
    assert.match(source, /const guardSubmit = \([^)]*write: \(\) => void\): void =>/, "the guard answers a question again");
  });
});

describe("applyVerdicts", () => {
  it("hands back the very same object when the retraction changes nothing", () => {
    // The render loop. A server refusal on an untouched path retracts to `{ null, false }` after every
    // render; a fresh object each time would re-render forever, so identity is the termination condition.
    const current: FieldVerdicts = { shorthand: { message: null, differs: false } };

    assert.equal(applyVerdicts(current, { shorthand: { message: null, differs: false } }), current);
  });

  it("hands back the same object when there is nothing to retract", () => {
    const current: FieldVerdicts = { shorthand: { message: null, differs: false } };

    assert.equal(applyVerdicts(current, null), current);
  });

  it("settles on the second pass, which is what ends the loop", () => {
    const retracted = { shorthand: { message: null, differs: true } };
    const first = applyVerdicts({}, retracted);

    assert.deepEqual(first, retracted);
    assert.equal(applyVerdicts(first, retracted), first);
  });

  it("still writes a retraction that genuinely moves a verdict", () => {
    const current: FieldVerdicts = { shorthand: { message: "Das Kürzel besteht aus genau 2 Zeichen.", differs: true } };
    const next = applyVerdicts(current, { shorthand: { message: null, differs: true } });

    assert.notEqual(next, current);
    assert.deepEqual(next, { shorthand: { message: null, differs: true } });
  });
});

function collectTsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

const sources = new Map(
  collectTsxFiles(SRC_DIR).map((file) => [path.relative(SRC_DIR, file).split(path.sep).join("/"), readFileSync(file, "utf8")]),
);

/**
 * **Every form, found by the element it renders, not by a marker a conforming form carries.** A listing
 * filtered on the property it asserts cannot fail, so a form holding neither the prop nor the hook
 * stays invisible to its own sweep (PRE-4).
 */
const RENDERS_A_FORM = /^\s*<Form(?![\w.])/m;

/** The same net without the position, so a render the strict pattern misses lands in the difference below. */
const MENTIONS_A_FORM = /<Form(?![\w.])/;

const formFiles = [...sources].filter(([, text]) => RENDERS_A_FORM.test(text)).map(([file]) => file);

/**
 * The files naming `<Form>` in prose alone. Named one by one rather than counted: a NEW file rendering a form in a
 * shape `RENDERS_A_FORM` cannot see lands here instead of vanishing, and this list is what refuses it.
 */
const PROSE_ONLY = [
  "features/bewerbungen/components/forms/AdminBewerbungAnnehmenSection.tsx",
  "features/bewerbungen/components/forms/BewerbungForm/FormSchuleSection.tsx",
  "features/spieler/components/forms/ClosedSetSelect.tsx",
  "features/spieler/components/forms/TeamSelect.tsx",
  "features/teams/components/forms/GruppeSelect.tsx",
  "features/teams/components/forms/WebsiteUrlField.tsx",
  "shared/components/ui/AddressFields.tsx",
];

describe("the sweep's own reach", () => {
  it("finds the same forms by two routes that share no condition", () => {
    // One listing reads WHERE `<Form` sits, the other every file naming it, less a hand-written allowlist.
    // Neither sees a marker only a conforming form carries, so narrowing either breaks the equality
    // instead of shrinking the sweep.
    const namesAForm = [...sources].filter(([, text]) => MENTIONS_A_FORM.test(text)).map(([file]) => file);
    const byElimination = namesAForm.filter((file) => !PROSE_ONLY.includes(file));

    // The anti-vacuity clause: a discriminator that stopped matching leaves every assertion below
    // true of an empty list, and the equality below true of two empty ones. Set under the tree, so
    // adding or retiring a form never moves it.
    assert.ok(formFiles.length >= 8, `expected at least 8 forms, found ${String(formFiles.length)}: ${formFiles.join(", ")}`);
    assert.deepEqual(formFiles, byElimination, "the two routes disagree: a form is swept by one and not the other");
  });

  for (const file of PROSE_ONLY) {
    it(`${file} still only talks about a form rather than rendering one`, () => {
      // The allowlist is the one hole both routes share: a render here that the line-start pattern cannot
      // see is invisible to each of them, so they agree on a wrong answer. Read from the AST, which sees a
      // `<Form>` wherever it sits on the line.
      const source = ts.createSourceFile(file, sources.get(file) ?? "", ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const rendered: string[] = [];

      const visit = (node: ts.Node): void => {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
          const opening = ts.isJsxElement(node) ? node.openingElement : node;
          if (opening.tagName.getText(source) === "Form")
            rendered.push(String(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1));
        }
        ts.forEachChild(node, visit);
      };

      visit(source);
      assert.deepEqual(rendered, [], `${file} renders a form at line ${rendered.join(", ")} while sitting on the prose allowlist`);
    });
  }
});

const pageOwnedEditors = [...sources].filter(([, text]) => text.includes("const resetDraftToStored =")).map(([file]) => file);

describe("every page-owned editor", () => {
  it("is discovered by the sweep", () => {
    // A floor rather than an exact count: what it guards is a discovery that silently finds nothing
    // after the routine is renamed, which would leave every assertion below vacuously true.
    assert.ok(
      pageOwnedEditors.length >= 7,
      `expected at least 7 page-owned editors, found ${String(pageOwnedEditors.length)}: ${pageOwnedEditors.join(", ")}`,
    );
  });

  for (const file of pageOwnedEditors) {
    it(`${file} routes its field errors through the composed hook`, () => {
      const source = sources.get(file) ?? "";

      assert.ok(source.includes("useDraftFieldErrors({"), `${file} does not take its field errors from useDraftFieldErrors`);
      // Holding the submit half directly is how the merge gets assembled at the call site again, and a
      // call site that merges in the wrong order fails silently: the refusal is produced and deleted.
      assert.ok(!source.includes("useServerFieldErrors("), `${file} holds the submit half directly instead of the composed hook`);
    });
  }

  for (const file of formFiles) {
    it(`${file} leaves missing values to the submit rather than to the browser`, () => {
      // The one mechanism, on every form. In `native` react-aria commits on each DOM `change`, so an
      // edited field cleared again paints the browser's required message on the blur.
      assert.match(sources.get(file) ?? "", /validationBehavior="aria"/, `${file} still lets the browser judge an emptied field`);
    });

    it(`${file} forgives against the payload it judges, not the draft beside it`, () => {
      // A LITERAL pin, not a property: two callers assemble a payload that is not the draft, and forgiving
      // against the draft judges a shape the schema never sees.
      const source = sources.get(file) ?? "";
      if (!source.includes("useForgiveFixed({ entity:")) return;

      assert.ok(source.includes("useForgiveFixed({ entity: toPayload(draft) });"), `${file} forgives against the wrong shape`);
    });

    it(`${file} blocks its own submit`, () => {
      // `aria` sets `noValidate` and drops every `required`, so the browser prevents nothing. A form
      // without this call posts whatever it holds and learns the rules from the server.
      assert.match(sources.get(file) ?? "", /guardSubmit\(/, `${file} sends an unjudged draft to the server`);
    });
  }

  for (const file of pageOwnedEditors) {
    it(`${file} forgives a corrected field without waiting for a blur`, () => {
      // Once per editor rather than once per field, which is what lets every input in it forgive on the
      // same terms. An editor that skips the call keeps painting until the admin leaves the field.
      assert.ok(sources.get(file)?.includes("useForgiveFixed({"), `${file} never re-judges what it is already showing`);
      // The same call carries the submit sweep, so an editor without it also leaves every date that
      // cannot be natively refused blocking the submit in silence.
    });
  }

  for (const file of pageOwnedEditors) {
    it(`${file} tells the submit which payload it was answering about`, () => {
      const source = sources.get(file) ?? "";

      // A refusal recorded with no payload behind it grades every later verdict as differing, which is
      // the old recency rule again: the next blur on the refused field deletes the message.
      assert.ok(/setSubmitFieldErrors\([^)]*,\s*\{/.test(source), `${file} records a refusal without the payload the submit was refused on`);
    });
  }
});
