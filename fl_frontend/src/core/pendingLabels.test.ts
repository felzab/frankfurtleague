import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..");

/** A test's fixture is not copy the product renders, so the sweep is held against what ships. */
const production = filesUnder(SRC_DIR, (name) => name.endsWith(".ts") || name.endsWith(".tsx"), 400)
  .map((file) => [path.relative(SRC_DIR, file).split(path.sep).join("/"), readFileSync(file, "utf8")] as const)
  .filter(([file]) => !isTestFile(file));

/**
 * Both spellings of the trailing ellipsis, so a label written with `…` is judged rather than
 * escaping the pool it would fail in — whichever quotation mark it is written between.
 */
const ENDS_ELLIPSED = /(?:\.\.\.|…)$/;

interface Ellipsed {
  readonly file: string;
  readonly text: string;
}

/**
 * Read off the parsed module rather than its text: a comment quoting a rendered string tracks it
 * without being one, and a scan of the file cannot tell that mention from the string itself.
 */
function ellipsedIn(file: string, text: string): { quoted: Ellipsed[]; templated: Ellipsed[] } {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const quoted: Ellipsed[] = [];
  const templated: Ellipsed[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node)) {
      if (ENDS_ELLIPSED.test(node.text)) quoted.push({ file, text: node.text });
    } else if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      // The source between the backticks, so an interpolation is named as the module spells it.
      const spelled = node.getText(source).slice(1, -1);
      if (ENDS_ELLIPSED.test(spelled)) templated.push({ file, text: spelled });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { quoted, templated };
}

const ellipsed = production.map(([file, text]) => ellipsedIn(file, text));
const quoted = ellipsed.flatMap((one) => one.quoted);
const templated = ellipsed.flatMap((one) => one.templated);

/**
 * An ellipsed string no control wears while a press runs: a picker's prompt, a reader's own
 * affordance, a readout cut at its width, and a field's report on a check nobody pressed for.
 */
const NOT_A_RUNNING_LABEL: readonly string[] = [
  "Schule auswählen...",
  "Schule finden...",
  "Team finden...",
  "Weiterlesen...",
  "Wir prüfen, ob das Kürzel noch frei ist...",
  "${label} finden...",
  "${value.slice(0, 59)}…",
];

const running = quoted.filter((entry) => !NOT_A_RUNNING_LABEL.includes(entry.text));

/**
 * A press says what it is doing: the third person singular, which closes on `-t` whatever the stem
 * does. An infinitive, a `Wir` and every form of `werden` close elsewhere, so the ending holds the
 * voice.
 */
const THIRD_PERSON = /t$/;

const opensWith = (text: string): string => (text.replace(ENDS_ELLIPSED, "").split(" ")[0] ?? "").toLowerCase();

describe("every label the product wears while a press runs", () => {
  it("is found by the sweep at all", () => {
    // A floor on the population, so a broken scan cannot leave every case below vacuously true.
    assert.ok(running.length >= 25, `expected at least 25 running labels, found ${String(running.length)}`);
  });

  it("declares each string that ends in an ellipsis and no control wears", () => {
    // The other direction: an entry naming a string the tree has dropped is stale, and leaving it
    // would let the list quietly exempt a label somebody writes under that wording later.
    const present = new Set([...quoted, ...templated].map((entry) => entry.text));
    const stale = NOT_A_RUNNING_LABEL.filter((text) => !present.has(text));
    assert.deepEqual(stale, [], "a declared exemption names a string the tree no longer holds");
  });

  it("is written as a plain literal, never as a template", () => {
    const interpolated = templated.filter((entry) => !NOT_A_RUNNING_LABEL.includes(entry.text)).map((entry) => `${entry.file}: ${entry.text}`);
    assert.deepEqual(interpolated, [], "a running label reaches no literal the cases below can read. Write the label out.");
  });

  it("ends in three dots, the one spelling the product uses", () => {
    const wrongEllipsis = running.filter((entry) => entry.text.endsWith("…")).map((entry) => `${entry.file}: ${entry.text}`);
    assert.deepEqual(wrongEllipsis, [], "a running label ends in `…` where every other ends in `...`");
  });

  it("says what the press itself is doing", () => {
    const notThePress = running.filter((entry) => !THIRD_PERSON.test(opensWith(entry.text))).map((entry) => `${entry.file}: ${entry.text}`);
    assert.deepEqual(
      notThePress,
      [],
      "a running label opens on something other than a third-person verb -- an infinitive, a `Wir`, or the passive `wird`. Say what the press is doing: `Speichert...`, `Meldet ab...`.",
    );
  });
});
