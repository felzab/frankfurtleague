/**
 * SHARED · the submit wiring, swept across every form that holds a draft
 *
 * A form whose fields are React state cannot use React's `action` prop: React resets such a form on
 * every submit and react-aria's `useFormReset` turns that reset into `onChange(initialValue)` on each
 * field, so the draft is gone and any Hinweis derived from it is gone with it — silently, past
 * `tsc`, ESLint and the build.
 *
 * Invariants:
 * - The sweep discovers its subjects, so a new editor is covered without an edit here.
 * - `useServerFieldErrors(` marks a controlled draft; the sign-in form has none and keeps its action.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { runOnSubmit } from "./formSubmit.ts";

import type { FormEvent } from "react";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

function collectTsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

/** Relative POSIX path → source text, for every component in the tree. */
const sources = new Map(
  collectTsxFiles(SRC_DIR).map((file) => [path.relative(SRC_DIR, file).split(path.sep).join("/"), readFileSync(file, "utf8")]),
);

const filesContaining = (needle: string): string[] => [...sources].filter(([, text]) => text.includes(needle)).map(([file]) => file);

/** The forms whose values live in React state rather than in the DOM. */
const draftForms = filesContaining("useServerFieldErrors(");

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
      assert.ok(sources.get(file)?.includes("<Form"), `${file} calls useServerFieldErrors but renders no <Form>`);
      assert.ok(sources.get(file)?.includes("onSubmit={runOnSubmit("), `${file} does not submit through runOnSubmit`);
      // React resets a form whose `action` is a function, and the reset reaches the draft through
      // react-aria's per-field listeners. Matched at a JSX prop position, so `onAction` and a
      // `data-action` attribute are not mistaken for it.
      assert.ok(!/\saction=\{/.test(sources.get(file) ?? ""), `${file} passes an action to a form whose fields are controlled`);
    });
  }
});

/** The state atom holding the gate's snapshot, whatever the editor calls it. */
const SNAPSHOT_STATE = /const \[(\w+), set\w+\] = useState<BlockingBanners \| null>\(null\)/;

describe("every editor raising the save confirmation", () => {
  for (const file of filesContaining("<ConfirmSaveModal")) {
    it(`${file} shows the snapshot the gate took, not a live derivation`, () => {
      const source = sources.get(file) ?? "";

      assert.ok(source.includes("resolveBlockingBanners(banners)"), `${file} derives its gate some other way`);

      // The whole of ADR-0070's snapshot clause: the dialog's list has to be state, because a value
      // recomputed each render can change while the admin is reading what they are agreeing to.
      const held = SNAPSHOT_STATE.exec(source)?.[1];
      assert.ok(held, `${file} holds no BlockingBanners snapshot in state`);
      assert.ok(source.includes(`banners={${held}}`), `${file} renders the dialog on something other than its snapshot`);
    });
  }
});
