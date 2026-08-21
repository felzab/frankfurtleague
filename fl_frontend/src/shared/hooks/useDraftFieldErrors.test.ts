import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

// Relative imports, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { differsFromSubmitted, mergeFieldVerdicts } from "./useDraftFieldErrors.ts";

import type { FieldVerdicts } from "./useDraftFieldErrors.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..");

/** The German sentence a Spieltag occupancy refusal puts on a side — a rule only the server holds. */
const SERVER_REFUSAL = "Dieses Team spielt am selben Spieltag bereits in einem anderen Spiel.";

/** What a payload schema says about an emptied count, which is all a client verdict can ever know. */
const CLIENT_MESSAGE = "Bitte gib die Treffer von Team 1 ein.";

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
 * The page-owned editors, discovered by `resetDraftToStored` rather than a filename pattern: that routine is what makes
 * a form a page-owned editor (§1.10 in `docs/frontend/spec.md`), where the filenames share no pattern.
 */
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

  for (const file of pageOwnedEditors) {
    it(`${file} tells the submit which payload it was answering about`, () => {
      const source = sources.get(file) ?? "";

      // A refusal recorded with no payload behind it grades every later verdict as differing, which is
      // the old recency rule again: the next blur on the refused field deletes the message.
      assert.ok(/setSubmitFieldErrors\([^)]*,\s*\{/.test(source), `${file} records a refusal without the payload the submit was refused on`);
    });
  }
});
