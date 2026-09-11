import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..");

/** A test's fixture is not copy the product renders, so the sweep is held against what ships. */
const production = filesUnder(SRC_DIR, (name) => name.endsWith(".ts") || name.endsWith(".tsx"), 400)
  .map((file) => [path.relative(SRC_DIR, file).split(path.sep).join("/"), readFileSync(file, "utf8")] as const)
  .filter(([file]) => !isTestFile(file));

/**
 * A string the reader meets while a press is in flight. Both spellings of the trailing ellipsis are
 * read, so a label written with `…` is judged rather than escaping the pool it would fail in.
 */
const QUOTED = /"([^"\n]*?(?:\.\.\.|…))"/g;

/** The same ending inside a template, whose text the voice case cannot read — so a label takes none. */
const TEMPLATED = /`([^`]*?\.\.\.)`/g;

interface Ellipsed {
  readonly file: string;
  readonly text: string;
}

function collect(pattern: RegExp): Ellipsed[] {
  const found: Ellipsed[] = [];
  for (const [file, source] of production) {
    for (const match of source.matchAll(pattern)) if (match[1] !== undefined) found.push({ file, text: match[1] });
  }
  return found;
}

const quoted = collect(QUOTED);
const templated = collect(TEMPLATED);

/**
 * A string ending in an ellipsis that names no action in flight: a picker's prompt and a reader's
 * own affordance both rest, so neither takes a verb the way a press does.
 */
const NOT_A_RUNNING_LABEL: readonly string[] = [
  "Schule auswählen...",
  "Schule finden...",
  "Team finden...",
  "${label} finden...",
  "Weiterlesen...",
];

const running = quoted.filter((entry) => !NOT_A_RUNNING_LABEL.includes(entry.text));

/**
 * German builds the passive from `werden`, so a label opening with one of these forms says the press
 * is having something done to it rather than what it is doing.
 */
const PASSIVE_AUXILIARY: readonly string[] = ["wird", "werden", "wurde", "wurden"];

describe("every label the product wears while a press runs", () => {
  it("is found by the sweep at all", () => {
    // A floor on the population, so a broken scan cannot leave every case below vacuously true.
    assert.ok(running.length >= 25, `expected at least 25 running labels, found ${String(running.length)}`);
  });

  it("declares each string that ends in an ellipsis and names no running action", () => {
    // The other direction: an entry the tree no longer holds is stale, and leaving it would let the
    // list quietly exempt a label somebody writes under that wording later.
    const present = new Set([...quoted, ...templated].map((entry) => entry.text));
    const stale = NOT_A_RUNNING_LABEL.filter((text) => !present.has(text));
    assert.deepEqual(stale, [], "a declared exemption names a string the tree no longer holds");
  });

  it("is written as a plain literal, never as a template", () => {
    const interpolated = templated.filter((entry) => !NOT_A_RUNNING_LABEL.includes(entry.text)).map((entry) => `${entry.file}: ${entry.text}`);
    assert.deepEqual(interpolated, [], "a running label reaches no literal the case below can read. Write the label out.");
  });

  it("ends in three dots, the one spelling the product uses", () => {
    const wrongEllipsis = running.filter((entry) => entry.text.endsWith("…")).map((entry) => `${entry.file}: ${entry.text}`);
    assert.deepEqual(wrongEllipsis, [], "a running label ends in `…` where every other ends in `...`");
  });

  it("is in the active voice", () => {
    const passive = running
      .filter((entry) => PASSIVE_AUXILIARY.includes((entry.text.split(" ")[0] ?? "").toLowerCase()))
      .map((entry) => `${entry.file}: ${entry.text}`);
    assert.deepEqual(
      passive,
      [],
      "a running label opens with the passive auxiliary. Say what the press is doing: `Speichert...`, `Meldet ab...`.",
    );
  });
});
