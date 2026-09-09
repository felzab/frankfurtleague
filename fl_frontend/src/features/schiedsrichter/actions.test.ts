import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No `next/navigation` export carries either context, and these two components reach `useRouter` and
   the season a link keeps between them (`fl_frontend/src/features/kontakte/editor.test.ts` mounts both). */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { declaredCodes, sliceBetween } from "../../core/refusalRegister.ts";
import { renderTree, textOf } from "../../shared/testing/renderTest.ts";
import { SCHIEDSRICHTER_ANONYM_LABEL } from "./constants.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { FormAnonymisierenSection } = await import("./components/forms/AdminSchiedsrichterEditForm/FormAnonymisierenSection.tsx");
const { AdminSchiedsrichterGeloeschtView } = await import("./components/views/AdminSchiedsrichterGeloeschtView.tsx");

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");
const MUTATIONS = readFileSync(path.resolve(import.meta.dirname, "mutations.ts"), "utf8");
// Whitespace-collapsed: the panel's copy is JSX text, so the formatter picks its line breaks.
/**
 * Read rather than rendered for the claims a resting render cannot carry: the copy a second press
 * reveals, an absence spanning every state, and which name the displayed word is read from.
 */
const PANEL = readFileSync(
  path.resolve(import.meta.dirname, "components", "forms", "AdminSchiedsrichterEditForm", "FormAnonymisierenSection.tsx"),
  "utf8",
).replace(/\s+/g, " ");
/**
 * Read rather than rendered for what it carries alone: which value the editor hands the panel. The
 * panel's markup is the same whichever of the two it was given.
 */
const EDIT_FORM = readFileSync(
  path.resolve(import.meta.dirname, "components", "forms", "AdminSchiedsrichterEditForm", "AdminSchiedsrichterEditForm.tsx"),
  "utf8",
).replace(/\s+/g, " ");
const SCHEMAS = readFileSync(path.resolve(import.meta.dirname, "schemas.ts"), "utf8");
/**
 * Read rather than rendered for the `key` that makes the panel's refresh load-bearing: a remount is
 * what one press produces, and a render answers with the mount it was given.
 */
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

const EDIT_OPERATION = "PATCH /schiedsrichter/{schiedsrichter_id}";
const EDIT_CODES = ["REQ-ANONYMISE-002"];
const EDIT_MAP = sliceBetween(ACTIONS, "function mapEditRefusal", "function mapRetireRefusal");

/* The first mapper in the module, so its slice ends where the edit's begins. */
const NAME_MAP = sliceBetween(ACTIONS, "function mapNameRefusal", "function mapEditRefusal");
const CREATE_ACTION = sliceBetween(
  ACTIONS,
  "export async function postSchiedsrichterAction",
  "export async function patchSchiedsrichterAction",
);
/* The venue's copy of the same sentence, read where it is written rather than retyped here. */
const SPIELORTE_ACTIONS = readFileSync(path.resolve(import.meta.dirname, "..", "spielorte", "actions.ts"), "utf8");

const REACTIVATE_OPERATION = "POST /schiedsrichter/{schiedsrichter_id}/reactivate";
const REACTIVATE_CODES = ["REQ-ANONYMISE-003"];
/* Read per slice for the anonymisation's reason: three mappers live here now. */
const REACTIVATE_MAP = sliceBetween(ACTIONS, "function mapReactivateRefusal", "function mapAnonymiseRefusal");
const REACTIVATE_ACTION = sliceBetween(
  ACTIONS,
  "export async function reactivateSchiedsrichterAction",
  "export async function anonymiseSchiedsrichterAction",
);
const UNDO_ROUTE = readFileSync(
  path.resolve(REPO_ROOT, "fl_frontend", "src", "app", "api", "admin", "schiedsrichter", "undo", "route.ts"),
  "utf8",
);

describe("the anonymisation against the backend's refusal register", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/core/refusalRegister.ts :: sliceBetween`). */
  it("cuts the mapper and the action out of the file before reading them", () => {
    assert.ok(ANONYMISE_MAP.includes("serverErrorCode"), "the anonymisation's arms are outside its slice");
    assert.ok(!ANONYMISE_MAP.includes("REQ-RETIRE-004"), "the anonymisation's slice runs back into the retire's mapper");

    assert.ok(ANONYMISE_ACTION.includes("anonymiseSchiedsrichter(validated.data)"), "the anonymisation's call is outside its slice");
    assert.ok(!ANONYMISE_ACTION.includes("deleteSchiedsrichter("), "the anonymisation's slice reaches the retire");
    assert.ok(RETIRE_ACTION.includes("mapRetireRefusal(error)"), "the retire's slice no longer holds its mapper call");

    assert.ok(RENAME_ACTION.includes("patchSchiedsrichter(validated.data)"), "the rename's slice is outside its slice");
    assert.ok(!RENAME_ACTION.includes("anonymiseSchiedsrichter("), "the rename's slice reaches the anonymisation");

    assert.ok(REACTIVATE_MAP.includes("serverErrorCode"), "the reactivation's arms are outside its slice");
    assert.ok(!REACTIVATE_MAP.includes("REQ-ANONYMISE-001"), "the reactivation's slice runs on into the anonymisation's mapper");
    assert.ok(REACTIVATE_ACTION.includes("reactivateSchiedsrichter(validated.data)"), "the reactivation's call is outside its slice");
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
  /* Both German sites, per `.claude/rules/cross-surface.md`: the undo route replays this endpoint,
     so a code the save words and the replay does not reaches the admin as the 409 fallback. */
  it("maps every refusal the edit declares, on the save and on the undo", () => {
    const declared = declaredCodes(EDIT_OPERATION);

    // Asserted before the loop: a register that stopped naming the operation runs it zero times, green.
    assert.deepEqual(declared, EDIT_CODES);
    for (const code of declared) {
      assert.ok(EDIT_MAP.includes(`serverErrorCode === "${code}"`), `${code} reaches the admin as an unhandled conflict`);
      assert.ok(UNDO_ROUTE.includes(`"${code}":`), `${code} reaches the undo as an unhandled conflict`);
    }

    assert.ok(RENAME_ACTION.includes("mapEditRefusal(error)"), "the edit consults some other mapper");
  });

  it("leaves the retirement's own refusal on the retirement", () => {
    assert.deepEqual(declaredCodes("DELETE /schiedsrichter/{schiedsrichter_id}"), ["REQ-RETIRE-004"]);
    assert.ok(RETIRE_ACTION.includes("mapRetireRefusal(error)"), "the retire stopped consulting its mapper");
    assert.ok(!RETIRE_ACTION.includes("mapAnonymiseRefusal"), "the contact deletion's refusal is reported about a retirement");
  });

  /* The erasure retires the referee, so this endpoint refuses one whose data are gone. It has no undo
     route: the replay wording of `route.ts` covers the save alone. */
  it("maps the refusal the reactivation declares", () => {
    const declared = declaredCodes(REACTIVATE_OPERATION);

    // Asserted before the loop: a register that stopped naming the operation runs it zero times, green.
    assert.deepEqual(declared, REACTIVATE_CODES);
    for (const code of declared)
      assert.ok(REACTIVATE_MAP.includes(`serverErrorCode === "${code}"`), `${code} reaches the admin as an unhandled conflict`);

    assert.ok(REACTIVATE_ACTION.includes("mapReactivateRefusal(error)"), "the reactivation consults no mapper at all");
    assert.ok(!REACTIVATE_ACTION.includes("mapRetireRefusal"), "the retire's refusal is reported about a reactivation");
  });

  /* These administrators are teachers, and the one thing this sentence must not do is suggest a way
     back: nothing in the system can restore the deleted values. */
  it("words the reactivation's refusal without offering an undo", () => {
    assert.match(REACTIVATE_MAP, /Daten löschen lassen/, "the refusal does not say why the entry is stilled");
    assert.match(REACTIVATE_MAP, /neuen Schiedsrichter/, "the refusal names no way forward for a person who officiates again");
    assert.doesNotMatch(REACTIVATE_MAP, /wiederherstell|zurückhol|rückgängig/i, "the refusal offers a restore no endpoint can honour");
  });
});

describe("the referee name a unique index already holds", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/core/refusalRegister.ts :: sliceBetween`). */
  it("cuts the mapper and the create out of the file before reading them", () => {
    assert.ok(NAME_MAP.includes("serverErrorCode"), "the duplicate name's arm is outside its slice");
    assert.ok(!NAME_MAP.includes("REQ-ANONYMISE-002"), "the duplicate name's slice runs on into the edit's mapper");

    assert.ok(CREATE_ACTION.includes("postSchiedsrichter(validated.data)"), "the create's call is outside its slice");
    assert.ok(!CREATE_ACTION.includes("patchSchiedsrichter("), "the create's slice runs on into the edit");
  });

  /* `uniq_schiedsrichter_name` is this collection's only unique index, so the 409 it raises is always
     the name. Unmapped, `fl_frontend/src/shared/utils/actionError.ts` answers it with a sentence about
     an id, which names no box and no way out. */
  it("lands the duplicate on the name box rather than in a banner", () => {
    assert.match(NAME_MAP, /serverErrorCode === "DB-COMMON-002"/, "the duplicate name reaches the admin as an unhandled conflict");
    assert.match(NAME_MAP, /fieldErrors: \{ name: "Diesen Namen gibt es schon\." \}/, "the duplicate name lands as a bare sentence");
    // The field message carries no second sentence: the box under it is the way out (`docs/frontend/spec.md` §1.12).
    assert.doesNotMatch(NAME_MAP, /buildRefusal\(/, "the duplicate name is composed as a two-sentence banner");
  });

  /* The edit weighs the erasure's refusal first and this one after: both are 409s on one save, and a
     mapper consulted alone leaves the other code falling through to the conflict fallback. */
  it("consults the mapper on the create and beside the edit's own refusal", () => {
    assert.ok(CREATE_ACTION.includes("mapNameRefusal(error)"), "the create consults no mapper, so a duplicate name reaches the error page");
    assert.match(RENAME_ACTION, /mapEditRefusal\(error\) \?\? mapNameRefusal\(error\)/, "the edit weighs only one of its two refusals");
  });

  /* One sentence for both slices: a reader meets the same box on four forms, and a rewording of one
     copy would tell two of them something the other two do not say. */
  it("words a venue's duplicate name the same way", () => {
    assert.match(SPIELORTE_ACTIONS, /fieldErrors: \{ name: "Diesen Namen gibt es schon\." \}/, "the two slices word one refusal apart");
  });
});

describe("what the anonymisation moves", () => {
  /* The one cached read it moves: the nulled name lands on every Spiel as a rename does, and without
     the tag the erased name keeps being served from cache. The referee list and the log are uncached. */
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

/** Nothing here is reached before a press: the refresh is what one produces. `bfcacheId` is a value. */
const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "",
};

/** The sentences a reader hears, tags gone and the JSX line breaks collapsed. */
const gelesen = (element: Parameters<typeof renderTree>[0]): string =>
  textOf(
    renderTree(h(AppRouterContext.Provider, { value: ROUTER }, h(SearchParamsContext.Provider, { value: new URLSearchParams() }, element))),
  )
    .replace(/\s+/g, " ")
    .trim();

/**
 * The panel at rest, which is the state an administrator meets it in: the readout and the two
 * paragraphs beside it are behind `ConfirmReveal` and reach no static render.
 */
const panelText = (): string =>
  gelesen(
    h(FormAnonymisierenSection, {
      schiedsrichterId: "68c1f0a2b3c4d5e6f7a8b9c0",
      name: "Anna Beispiel",
      schule: "Musterschule",
      kontakt: { email: "anna@example.de", telefon: "069 1234567" },
      onBeforeAnonymise: () => true,
    }),
  );

/** Both dates given, so every conditional row of the page stands and its whole copy is in the text. */
const geloeschtText = (): string =>
  gelesen(h(AdminSchiedsrichterGeloeschtView, { anonymisiertAm: "2026-03-01", inactiveSince: "2026-02-01", defaultPayment: 2500 }));

describe("the anonymisation's copy", () => {
  /* The school goes with the name, and both surfaces have to say so: an administrator who reads only
     „Name und Kontaktdaten“ tells the person their school is still on the record. */
  it("names the school among what goes, on the confirmation and on the page that replaces the form", () => {
    const geloescht = geloeschtText();

    // The list is the direct object of the panel's sentence and the subject of the other two, so its
    // first member is accusative on one surface and nominative on the others.
    for (const [read, where, list] of [
      [panelText(), "the confirmation", /Namen, Schule, E-Mail und Telefonnummer/],
      [geloescht, "the page that replaces the form", /Name, Schule, E-Mail und Telefonnummer/],
      [ACTIONS, "the action's report", /Name, Schule, E-Mail und Telefonnummer/],
    ] as const) {
      assert.match(read, list, `${where} does not name the school among what goes`);
    }

    assert.doesNotMatch(geloescht, /Schule \/ Verein/, "the erased page still reads the school out as something that survives");
  });

  it("says the name and the contact details go, in the row and in the log", () => {
    const gezeigt = panelText();

    assert.match(gezeigt, /E-Mail und Telefonnummer/, "the confirmation does not name what is deleted");
    assert.match(gezeigt, /Änderungsprotokoll/, "the confirmation does not say the log is reached");
    assert.match(PANEL, /Zurückholen lässt sich das nicht/, "the armed confirmation does not refuse an undo in words");
    assert.ok(!PANEL.includes("Rückgängig"), "the panel offers an undo, and no endpoint can honour one");
  });

  /* The name is nulled on every match and the ROW survives — every fixture embeds the id. Copy saying
     the row goes, or that the name stays, describes an operation the backend does not run. */
  it("says the name goes from every match, and the row survives with nothing left to edit", () => {
    const gezeigt = panelText();

    assert.match(gezeigt, /auf jedem gespielten Spiel/, "the confirmation does not say the played matches are reached");
    assert.match(PANEL, /Der Eintrag bleibt mit allen Spielen bestehen/, "the armed confirmation does not say the row survives");
    assert.match(gezeigt, /bearbeiten lässt er sich danach nicht mehr/, "the confirmation still offers an edit the write path refuses");
    assert.ok(!/Schiedsrichter\s+(endgültig\s+)?löschen<\/|Schiedsrichter wird gelöscht/.test(PANEL), "the copy claims the referee is deleted");
    assert.ok(!PANEL.includes("mit Namen"), "the copy still promises the name survives");
  });

  /* Next to the deletion rather than instead of it: an administrator told only that the entry is
     stilled reports a retirement to the person who asked to be erased. */
  it("names the retirement beside the deletion rather than in place of it", () => {
    const gezeigt = panelText();

    assert.match(gezeigt, /stillgelegt/, "the confirmation does not say the entry stops taking fixtures");
    assert.match(gezeigt, /für neue Spiele nicht mehr angeboten/, "the confirmation does not say what the retirement costs");
    assert.match(PANEL, /Zurückholen lässt sich das nicht/, "a copy naming only the retirement would read as reversible");
  });

  /* The subject is the ASSIGNMENT the erasure ends: it empties the booking on every fixture with no
     result, so an administrator not told here leaves a match nobody is going to officiate. */
  it("says on both surfaces that a fixture without a result needs a new referee", () => {
    for (const [source, where] of [
      [PANEL, "the armed confirmation"],
      [ACTIONS, "the action's report"],
    ] as const) {
      assert.match(source, /Spiele ohne Ergebnis/, `${where} does not name the fixtures the erasure unassigns`);
      assert.match(source, /neuen Schiedsrichter/, `${where} does not say such a fixture needs somebody else`);
      assert.ok(!/behalten die Zuteilung/.test(source), `${where} still promises the assignment survives the erasure`);
    }
  });

  /* Every other sentence about the erasure says „dieser Person“, and this one is the report an
     administrator forwards: a referee can be a woman, and the notice writes both forms. */
  it("reports the log redaction about a person rather than about a masculine referee", () => {
    const report = sliceBetween(ANONYMISE_ACTION, "Im Änderungsprotokoll", null);

    assert.match(report, /die diese Person betrifft/, "the report names the log rows by a masculine referee again");
  });

  /* The word is a frontend constant so it can be reworded without touching a stored document; typed
     into the copy instead, a rewording would leave the panel promising a word nothing renders. */
  it("names the displayed word by reading the constant rather than typing it", () => {
    assert.match(PANEL, /SCHIEDSRICHTER_ANONYM_LABEL/, "the panel does not read the label from its one declaration");
    assert.ok(!/„anonym|"anonym|>anonym/.test(PANEL), "the panel types the label as text, so rewording it leaves this copy behind");
    assert.equal(SCHIEDSRICHTER_ANONYM_LABEL, "anonym");
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

    for (const [read, where] of [
      [panelText(), "the panel"],
      [ACTIONS, "the action's report"],
    ] as const) {
      assert.match(read, /gesicherte[rn]? Stand/, `${where} does not name the pre-image the log keeps`);
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
    assert.match(panelText(), /Was wann geschehen ist, bleibt lesbar/, "the panel does not say what the log keeps");
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
