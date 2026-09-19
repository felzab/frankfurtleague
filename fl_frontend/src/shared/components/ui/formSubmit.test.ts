import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

import { runOnSubmit } from "./formSubmit.ts";

import type { FormEvent } from "react";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

// The needles below are literals this file writes, so under the `.tsx` spelling it would be swept
// into its own answer and counted among the editors it measures.
/** Relative POSIX path → source text, for every component the tree ships. */
const sources = new Map(
  filesUnder(SRC_DIR, (name) => name.endsWith(".tsx") && !isTestFile(name), 200).map((file) => [
    path.relative(SRC_DIR, file).split(path.sep).join("/"),
    readFileSync(file, "utf8"),
  ]),
);

const filesContaining = (needle: string): string[] => [...sources].filter(([, text]) => text.includes(needle)).map(([file]) => file);

/**
 * The forms whose values live in React state rather than in the DOM: the page-owned editors, which
 * hold the composed hook, and the create/edit shell, which has no draft schema to validate against
 * and holds the submit half alone.
 */
const draftForms = [...new Set([...filesContaining("useDraftFieldErrors("), ...filesContaining("useServerFieldErrors(")])];

describe("runOnSubmit", () => {
  it("stops the browser's own submit and runs the caller", () => {
    const seen: string[] = [];
    const event = { preventDefault: () => seen.push("prevented") } as unknown as FormEvent<HTMLFormElement>;

    runOnSubmit(() => seen.push("ran"))(event);

    assert.deepEqual(seen, ["prevented", "ran"]);
  });
});

describe("every form holding a draft", () => {
  it("is discovered by the sweep, page-owned editors and the create/edit shell alike", () => {
    // A floor rather than an exact count: what it guards is a discovery that silently finds nothing
    // after the hook is renamed, which would leave every assertion below vacuously true.
    assert.ok(draftForms.length >= 8, `expected at least 8 draft-holding forms, found ${String(draftForms.length)}: ${draftForms.join(", ")}`);
  });

  for (const file of draftForms) {
    it(`${file} submits through runOnSubmit and passes no action`, () => {
      // A substring answers to `<FormActionBar` and every other sibling whose name opens the same
      // way, which ten of these eleven render: the boundary is what makes this an element.
      assert.ok(/<Form(?![\w.])/.test(sources.get(file) ?? ""), `${file} holds a draft's field errors but renders no <Form>`);
      assert.ok(sources.get(file)?.includes("onSubmit={runOnSubmit("), `${file} does not submit through runOnSubmit`);
      // React resets a form whose `action` is a function, and the reset reaches the draft through
      // react-aria's per-field listeners. Matched at a JSX prop position, so `onAction` and a
      // `data-action` attribute are not mistaken for it.
      assert.ok(!/\saction=\{/.test(sources.get(file) ?? ""), `${file} passes an action to a form whose fields are controlled`);
    });
  }
});
