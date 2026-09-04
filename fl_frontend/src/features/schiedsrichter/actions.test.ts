import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { declaredCodes, sliceBetween } from "../../core/refusalRegister.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");
const MUTATIONS = readFileSync(path.resolve(import.meta.dirname, "mutations.ts"), "utf8");
/** Whitespace-collapsed: the panel's copy is JSX text, so the formatter picks its line breaks. */
const PANEL = readFileSync(
  path.resolve(import.meta.dirname, "components", "forms", "AdminSchiedsrichterEditForm", "FormAnonymisierenSection.tsx"),
  "utf8",
).replace(/\s+/g, " ");
const EDIT_FORM = readFileSync(
  path.resolve(import.meta.dirname, "components", "forms", "AdminSchiedsrichterEditForm", "AdminSchiedsrichterEditForm.tsx"),
  "utf8",
).replace(/\s+/g, " ");
const SCHEMAS = readFileSync(path.resolve(import.meta.dirname, "schemas.ts"), "utf8");
/** The page whose key is what makes the panel's refresh load-bearing. */
const PAGE = readFileSync(
  path.resolve(REPO_ROOT, "fl_frontend", "src", "app", "admin", "schiedsrichter", "[schiedsrichter_id]", "page.tsx"),
  "utf8",
).replace(/\s+/g, " ");
/** The backend redaction the panel's copy describes, read where it is written. */
const RECORDING = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "core", "recording.py"), "utf8");

const ANONYMISE_OPERATION = "POST /schiedsrichter/{schiedsrichter_id}/anonymisieren";
const ANONYMISE_CODES = ["REQ-ANONYMISE-001"];

/* The anonymisation is the last declaration in the module, so its slice runs to the end of the file. */
const ANONYMISE_ACTION = sliceBetween(ACTIONS, "export async function anonymiseSchiedsrichterAction", null);
/* Read per slice rather than over the file: two mappers live here, and a search over the whole source
   is satisfied by whichever one happens to carry the arm. */
const ANONYMISE_MAP = sliceBetween(ACTIONS, "function mapAnonymiseRefusal", "export async function postSchiedsrichterAction");
const RETIRE_ACTION = sliceBetween(
  ACTIONS,
  "export async function deleteSchiedsrichterAction",
  "export async function reactivateSchiedsrichterAction",
);
/* Sliced for the retire's reason, and for a second: the anonymisation carries the same `updateTag`
   call, so a search over the whole file passes whichever of the two happens to hold it. */
const RENAME_ACTION = sliceBetween(
  ACTIONS,
  "export async function patchSchiedsrichterAction",
  "export async function deleteSchiedsrichterAction",
);

describe("the anonymisation against the backend's refusal register", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/core/refusalRegister.ts :: sliceBetween`). */
  it("cuts the mapper and the action out of the file before reading them", () => {
    assert.ok(ANONYMISE_MAP.includes("serverErrorCode"), "the anonymisation's arms are outside its slice");
    assert.ok(!ANONYMISE_MAP.includes("REQ-RETIRE-004"), "the anonymisation's slice runs back into the retire's mapper");

    assert.ok(ANONYMISE_ACTION.includes("anonymiseSchiedsrichter(validated.data)"), "the anonymisation's call is outside its slice");
    assert.ok(!ANONYMISE_ACTION.includes("deleteSchiedsrichter("), "the anonymisation's slice reaches the retire");
    assert.ok(RETIRE_ACTION.includes("mapRetireRefusal(error)"), "the retire's slice no longer holds its mapper call");

    assert.ok(RENAME_ACTION.includes("patchSchiedsrichter(validated.data)"), "the rename's call is outside its slice");
    assert.ok(!RENAME_ACTION.includes("anonymiseSchiedsrichter("), "the rename's slice reaches the anonymisation");
  });

  /* A re-entry landing mid-anonymisation is the one refusal here, and it needs a sentence: the write
     looks done and the details are back. A rule declared later and left unmapped fails this. */
  it("maps every refusal its endpoint declares", () => {
    const declared = declaredCodes(ANONYMISE_OPERATION);

    // Asserted before the loop: a register that stopped naming the operation runs it zero times, green.
    assert.deepEqual(declared, ANONYMISE_CODES);
    for (const code of declared)
      assert.ok(ANONYMISE_MAP.includes(`serverErrorCode === "${code}"`), `${code} reaches the admin as an unhandled conflict`);

    assert.ok(ANONYMISE_ACTION.includes("mapAnonymiseRefusal(error)"), "the anonymisation consults some other mapper");
    assert.ok(!ANONYMISE_ACTION.includes("mapRetireRefusal"), "the retire's refusal is reported about a contact deletion");
  });

  /* `REQ-RETIRE-004` guards the retire and only the retire. Reaching it from here would refuse a
     contact deletion over fixtures the deletion does not touch. */
  it("leaves the retirement's own refusal on the retirement", () => {
    assert.deepEqual(declaredCodes("DELETE /schiedsrichter/{schiedsrichter_id}"), ["REQ-RETIRE-004"]);
    assert.ok(RETIRE_ACTION.includes("mapRetireRefusal(error)"), "the retire stopped consulting its mapper");
    assert.ok(!RETIRE_ACTION.includes("mapAnonymiseRefusal"), "the contact deletion's refusal is reported about a retirement");
  });
});

describe("what the anonymisation moves", () => {
  /* The one cached read it moves: the label fans into every Spiel as a rename does, and without the
     tag the erased name keeps being served from cache. The referee list and the log are uncached. */
  it("invalidates the fixture reads, as the rename does", () => {
    assert.ok(ANONYMISE_ACTION.includes('updateTag("spiele")'), "the anonymisation leaves the erased name in the fixture cache");
    assert.ok(RENAME_ACTION.includes('updateTag("spiele")'), "the rename stopped invalidating the one read a referee write does move");
  });

  /* A POST to `/anonymisieren`, never the DELETE beside it: that one stamps `inactive_since` and
     clears nothing. */
  it("calls the anonymisation endpoint and not the retire", () => {
    assert.match(MUTATIONS, /`\/schiedsrichter\/\$\{id\}\/anonymisieren`/, "the mutation no longer addresses the anonymisation endpoint");
    assert.match(
      MUTATIONS,
      /anonymisieren`,\s*FLSchiedsrichterWriteResponseSchema,\s*\{\s*method: "POST"/,
      "the anonymisation is sent as something other than a POST",
    );
  });
});

describe("the anonymisation's copy", () => {
  it("says the name and the contact details go, in the row and in the log", () => {
    assert.match(PANEL, /E-Mail und Telefonnummer/, "the confirmation does not name what is deleted");
    assert.match(PANEL, /Änderungsprotokoll/, "the confirmation does not say the log is reached");
    assert.match(PANEL, /Zurückholen lässt sich das nicht/, "the confirmation does not refuse an undo in words");
    assert.ok(!PANEL.includes("Rückgängig"), "the panel offers an undo, and no endpoint can honour one");
  });

  /* The name is replaced on every match and the ROW survives — every fixture embeds the id. Copy
     saying the row goes, or that the name stays, describes an operation the backend does not run. */
  it("says the name becomes the label on every match, and the referee survives", () => {
    assert.match(PANEL, /auf jedem Spiel/, "the confirmation does not say the matches are reached");
    assert.match(PANEL, /anonym/, "the confirmation does not name the label the referee is published under");
    assert.match(PANEL, /bleibt als Schiedsrichter bestehen/, "the confirmation does not say the referee survives");
    assert.ok(!/Schiedsrichter\s+(endgültig\s+)?löschen<\/|Schiedsrichter wird gelöscht/.test(PANEL), "the copy claims the referee is deleted");
    assert.ok(!PANEL.includes("mit Namen"), "the copy still promises the name survives");
    assert.ok(!PANEL.includes("stillgelegt"), "the copy confuses the deletion with a retirement");
  });

  it("arms before it writes", () => {
    // Panel-local: the write is reached only through `press` (`shared/hooks/useTwoPressConfirm.test.ts` pins the order).
    assert.match(PANEL, /press\(async \(\) => \{/, "the panel writes outside the armed press");
    assert.match(PANEL, /<ConfirmReveal>/, "the escalation replaces the copy in place with no announcement");
  });

  /* The refresh below remounts the form onto the cleared record, so an unsaved draft goes with it —
     the editor refuses to arm while one is open, and it is checked on BOTH presses. */
  it("refuses to run over an unsaved draft", () => {
    // Handed to the hook, which runs it before arming AND before writing -- that order is pinned at
    // `shared/hooks/useTwoPressConfirm.test.ts`, and the guard itself at `shared/utils/draftGuard.ts`.
    assert.match(PANEL, /useTwoPressConfirm\(onBeforeAnonymise\)/, "the panel arms over an unsaved draft");
    assert.match(EDIT_FORM, /onBeforeAnonymise=\{\(\) => guardAgainstDraft\(/, "the editor wires no draft guard to the panel");
    assert.match(
      readFileSync(path.resolve(import.meta.dirname, "../../shared/utils/draftGuard.ts"), "utf8"),
      /export function guardAgainstDraft\(isDirty: boolean/,
      "the guard no longer reads the draft",
    );
  });

  /* What the guard warns about is the LOSS the remount causes. A write-back is what happens with no
     refresh at all, which is the test below — the two failures are opposite and cannot share words. */
  it("warns about losing the draft, not about writing it back", () => {
    // The toast moved into the shared guard, so what the editor now passes is the subject the draft
    // is in the way of; the sentence around it lives at `shared/utils/draftGuard.ts`.
    const warning = /guardAgainstDraft\(\s*isDirty,\s*"([^"]*)"/.exec(EDIT_FORM)?.[1] ?? "";

    assert.notEqual(warning, "", "the guard no longer warns at all");
    // Three inflections of one verb: which one a sentence takes is its grammar rather than its meaning, and the
    // season editor's guard reaches for a different one than this editor does.
    assert.match(warning, /verwirft|verwerfen|verworfen/, "the guard does not say the unsaved changes are lost");
    assert.doesNotMatch(warning, /zurück|wieder ein/, "the guard describes a write-back the page's key rules out");
  });

  /* The STORED record, never the draft: this write clears what is saved, and a readout off typed
     values would name data the press does not reach. */
  it("reads the stored contact record", () => {
    assert.match(EDIT_FORM, /kontakt=\{schiedsrichter\.kontakt\}/, "the panel is handed the draft instead of the stored record");
  });
});

describe("the refresh that lands the cleared record", () => {
  /* Both halves or neither: without the key the refresh remounts nothing, and without the refresh
     the boxes keep the deleted values and the next save writes them back. */
  it("refreshes after the write, onto a view the page keys on the record", () => {
    assert.match(
      PANEL,
      /appToast\.success\("Schiedsrichterdaten gelöscht"[\s\S]*?router\.refresh\(\);/,
      "the cleared record never reaches the form",
    );
    assert.match(PAGE, /key=\{JSON\.stringify\(schiedsrichter\)\}/, "the view no longer remounts when the record changes");
  });

  /* The referee survives this write, so nothing may navigate away from their page. */
  it("stays on the page rather than leaving it", () => {
    assert.ok(!PANEL.includes("router.replace("), "the panel leaves a page whose subject still exists");
    assert.ok(!PANEL.includes("router.push("), "the panel leaves a page whose subject still exists");
  });
});

describe("how much of the log the copy claims", () => {
  /* `build_redaction_update` nulls `before` — the WHOLE pre-image of every row naming this referee,
     not the contact fields within it. A rename last month leaves a row holding the old name, and
     this write destroys that too. */
  it("matches what the redaction actually clears", () => {
    assert.match(RECORDING, /def build_redaction_update[\s\S]*?"before": None/, "the backend no longer clears the whole pre-image");

    for (const [source, where] of [
      [PANEL, "the panel"],
      [ACTIONS, "the action's report"],
    ] as const) {
      assert.match(source, /gesicherte[rn]? Stand/, `${where} does not name the pre-image the log keeps`);
    }
  });

  /* The narrow claim, in the shape it was written: the log's rows lose more than the row does. */
  it("never says the log loses only the contact details", () => {
    assert.doesNotMatch(PANEL, /Telefonnummer[^.]*(auch|und überall)[^.]*Änderungsprotokoll/, "the panel narrows the log to the two fields");
    assert.doesNotMatch(ACTIONS, /gelöscht, auch im Änderungsprotokoll/, "the report narrows the log to the two fields");
  });

  /* What survives is as load-bearing as what goes: the rows stay, so the log still shows that
     something happened and when. */
  it("says the rows themselves stay readable", () => {
    assert.match(PANEL, /Was wann geschehen ist, bleibt lesbar/, "the panel does not say what the log keeps");
  });
});

describe("the anonymisation's payload, beside the retirement's", () => {
  /* Its own declaration, as the pupil's erasure has: the retire and its reactivate are inverses of
     one another and this write has no inverse at all. Shared, a value typed for a retirement reaches
     the deletion while reading as one. */
  it("is declared on its own and parsed by the anonymisation alone", () => {
    assert.match(SCHEMAS, /export const FLAnonymiseSchiedsrichterPayloadSchema = z\.object\(/, "the anonymisation shares the reversible key");
    assert.ok(
      ANONYMISE_ACTION.includes("FLAnonymiseSchiedsrichterPayloadSchema.safeParse"),
      "the anonymisation validates against some other schema",
    );
    assert.ok(!ANONYMISE_ACTION.includes("FLSchiedsrichterKeyPayloadSchema"), "the retirement's key is still reachable from the deletion");
  });

  /* The pair that stays shared, and the doc beside it, which may no longer name three calls. */
  it("leaves the retire and its reactivate on the shared key", () => {
    assert.ok(RETIRE_ACTION.includes("FLSchiedsrichterKeyPayloadSchema.safeParse"), "the retire moved off the shared key");

    const sharedDoc = /\/\*\* ([^*]*) \*\/\s*export const FLSchiedsrichterKeyPayloadSchema/.exec(SCHEMAS)?.[1] ?? "";

    assert.notEqual(sharedDoc, "", "the shared key lost the doc line that says which calls take it");
    assert.doesNotMatch(sharedDoc, /anonymis/, "the shared key still claims the anonymisation");
  });
});
