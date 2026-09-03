import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder } from "@/core/treeWalk.ts";

import { runOnSubmit } from "./formSubmit.ts";

import type { FormEvent } from "react";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

/** Relative POSIX path → source text, for every component in the tree. */
const sources = new Map(
  filesUnder(SRC_DIR, (name) => name.endsWith(".tsx"), 200).map((file) => [
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
      assert.ok(sources.get(file)?.includes("<Form"), `${file} holds a draft's field errors but renders no <Form>`);
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

/** The editor's own banners, optionally less the refusals the save gate does not confirm. */
const GATE_ARGUMENT = /resolveBlockingBanners\(banners(?:\.filter\(\(banner\) => !isSpielRefusalBannerId\(banner\.id\)\))?\)/;

const confirmingEditors = filesContaining("<ConfirmSaveModal");

describe("every editor raising the save confirmation", () => {
  it("is discovered by the dialog it renders", () => {
    // A renamed dialog leaves this sweep looping over nothing, which is the one answer it cannot
    // tell apart from a clean one. Set under the tree, so retiring an editor never moves it.
    assert.ok(
      confirmingEditors.length >= 5,
      `expected at least 5 editors raising the save confirmation, found ${String(confirmingEditors.length)}`,
    );
  });

  for (const file of confirmingEditors) {
    it(`${file} shows the snapshot the gate took, not a live derivation`, () => {
      const source = sources.get(file) ?? "";

      // The WHOLE argument: a prefix match would accept a filter that empties the list and
      // silently disables the gate. One narrowing is permitted by name, a delivered refusal
      // being no consequence to confirm.
      assert.match(source, GATE_ARGUMENT, `${file} derives its gate some other way`);

      // The dialog's list has to be state, because a value recomputed each render can change while
      // the admin is reading what they are agreeing to.
      const held = SNAPSHOT_STATE.exec(source)?.[1];
      assert.ok(held, `${file} holds no BlockingBanners snapshot in state`);
      assert.ok(source.includes(`banners={${held}}`), `${file} renders the dialog on something other than its snapshot`);
    });
  }
});
