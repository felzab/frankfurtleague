import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { afterEach, describe, it, mock } from "node:test";

import { createElement as h } from "react";
/* No `next/navigation` export carries either context, and these two components reach `useRouter` and
   the season a link keeps between them (`fl_frontend/src/features/kontakte/editor.test.ts` mounts both). */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { DOUBLE_PRESS_MS } from "@/shared/hooks/useTwoPressConfirm.ts";
import { doubleActions } from "@/shared/testing/actionDoubles.ts";
import { declaredCodes, sliceBetween } from "@/shared/testing/refusalRegister.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import { SCHIEDSRICHTER_ANONYM_LABEL } from "./constants.ts";

import type { ReactNode } from "react";

type Geworfen = { variant: string; title: string; description?: string };

/* Every write hangs until a case answers it: a real action needs a session and a backend. */
const { calls: aufrufe, answerWith: antworte } = doubleActions({
  modules: ["/src/features/schiedsrichter/actions.ts"],
  answer: () => new Promise<never>(() => undefined),
});

const toasts: Geworfen[] = [];
(globalThis as unknown as Record<string, unknown>).__flSchiedsToasts = toasts;

/* Replaced as `fl_frontend/src/shared/utils/undoDispatch.test.ts` replaces it: the real module hands its
   raising to HeroUI's queue rather than back to the case that caused it. */
const APP_TOAST = `const raise = (variant) => (title, options) => {
  globalThis.__flSchiedsToasts.push({ variant, title, description: options?.description });
  return String(globalThis.__flSchiedsToasts.length);
};
export const UNDO_TIMEOUT_MS = 1;
export const appToast = { success: raise("success"), warning: raise("warning"), danger: raise("danger"), info: raise("info"), pending: raise("pending"), close: () => {}, clear: () => {} };`;

registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/shared/utils/appToast.ts")) return { format: "module", source: APP_TOAST, shortCircuit: true };
    return nextLoad(url, context);
  },
});

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { FormAnonymisierenSection } = await import("./components/forms/AdminSchiedsrichterEditForm/FormAnonymisierenSection.tsx");
const { AdminSchiedsrichterGeloeschtView } = await import("./components/views/AdminSchiedsrichterGeloeschtView.tsx");
const { AdminSchiedsrichterEditView } = await import("./components/views/AdminSchiedsrichterEditView.tsx");

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");
const MUTATIONS = readFileSync(path.resolve(import.meta.dirname, "mutations.ts"), "utf8");
/**
 * Whitespace-collapsed, the copy being JSX text whose line breaks the formatter picks. Read for which
 * declaration the displayed word comes from, which a render of the constant's value cannot tell apart.
 */
const PANEL = readFileSync(
  path.resolve(import.meta.dirname, "components", "forms", "AdminSchiedsrichterEditForm", "FormAnonymisierenSection.tsx"),
  "utf8",
).replace(/\s+/g, " ");
const SCHEMAS = readFileSync(path.resolve(import.meta.dirname, "schemas.ts"), "utf8");
/**
 * Read for the `key` that makes the panel's refresh load-bearing, which the page seats inside an async
 * Server Component behind its own awaits.
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
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/shared/testing/refusalRegister.ts :: sliceBetween`). */
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
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/shared/testing/refusalRegister.ts :: sliceBetween`). */
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

/** Each navigation a press makes, in order. */
const navigiert: string[] = [];

/** Recording the three calls that move or reload the page. `bfcacheId` is a value rather than a call. */
const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => void navigiert.push("refresh"),
  push: () => void navigiert.push("push"),
  replace: () => void navigiert.push("replace"),
  prefetch: () => undefined,
  bfcacheId: "",
};

const underNext = (tree: ReactNode): ReactNode =>
  h(AppRouterContext.Provider, { value: ROUTER }, h(SearchParamsContext.Provider, { value: new URLSearchParams() }, tree));

/** The sentences a reader hears, tags gone and the JSX line breaks collapsed. */
const gelesen = (element: ReactNode): string =>
  textOf(renderTree(underNext(element)))
    .replace(/\s+/g, " ")
    .trim();

const PANEL_PROPS = {
  schiedsrichterId: "68c1f0a2b3c4d5e6f7a8b9c0",
  name: "Anna Beispiel",
  schule: "Musterschule",
  kontakt: { email: "anna@example.de", telefon: "069 1234567" },
  onBeforeAnonymise: () => true,
};

/** The panel at rest, which is the state an administrator meets it in. */
const panelText = (): string => gelesen(h(FormAnonymisierenSection, PANEL_PROPS));

/** The same panel over a row a hand-write left nameless, which the editor serves like any other. */
const namenlosPanelText = (): string =>
  gelesen(h(FormAnonymisierenSection, { ...PANEL_PROPS, name: null, schule: null, kontakt: { email: null, telefon: null } }));

/** Both dates given, so every conditional row of the page stands and its whole copy is in the text. */
const geloeschtText = (): string =>
  gelesen(h(AdminSchiedsrichterGeloeschtView, { anonymisiertAm: "2026-03-01", inactiveSince: "2026-02-01", defaultPayment: 2500 }));

const RECORD = {
  id: "68c1f0a2b3c4d5e6f7a8b9c0",
  name: "Anna Beispiel",
  schule: "Musterschule",
  kontakt: { email: "anna@example.de", telefon: "069 1234567" },
  default_payment: 25,
};

afterEach(() => {
  aufrufe.length = 0;
  toasts.length = 0;
  navigiert.length = 0;
  antworte(() => new Promise<never>(() => undefined));
});

/** The editor the page mounts for a referee nobody erased, whose last panel is the erasure. */
const renderEditor = () =>
  render(underNext(h(AdminSchiedsrichterEditView, { schiedsrichter: RECORD, inactiveSince: null, anonymisiertAm: null })));

const erasureButton = () => screen.getByRole("button", { name: /^(Ja, )?Daten (endgültig )?löschen$/ });

/** The announcement the first press raises, or `null` where it raised none. */
const alarm = (): string | null => screen.queryByRole("alert")?.textContent.replace(/\s+/g, " ").trim() ?? null;

/** Both presses, the second after the double-press window. */
async function pressTwice(user: ReturnType<typeof userEvent.setup>, between: () => Promise<void> = async () => undefined): Promise<void> {
  mock.timers.enable({ apis: ["Date"] });
  try {
    await user.click(erasureButton());
    await between();
    mock.timers.tick(DOUBLE_PRESS_MS);
    await user.click(erasureButton());
  } finally {
    mock.timers.reset();
  }
}

/** A draft that differs from the stored record, typed as an administrator types one. */
async function typeADraft(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByRole("textbox", { name: "Name" }), " B.");
}

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

  /* The name is nulled on every match and the ROW survives — every fixture embeds the id. Copy saying
     the row goes, or that the name stays, describes an operation the backend does not run. */
  it("says the name and the contact details go from the row, every match and the log, and the row stays", () => {
    const gezeigt = panelText();

    assert.match(gezeigt, /E-Mail und Telefonnummer/, "the confirmation does not name what is deleted");
    assert.match(gezeigt, /Änderungsprotokoll/, "the confirmation does not say the log is reached");
    assert.match(gezeigt, /[Aa]uf jedem gespielten Spiel/, "the confirmation does not say the played matches are reached");
    assert.match(gezeigt, /[Bb]earbeiten lässt er sich danach nicht mehr/, "the confirmation still offers an edit the write path refuses");
    assert.ok(!/Schiedsrichter\s+(endgültig\s+)?löschen|Schiedsrichter wird gelöscht/.test(gezeigt), "the copy claims the referee is deleted");
    assert.ok(!gezeigt.includes("mit Namen"), "the copy still promises the name survives");
  });

  /* The subject is the ASSIGNMENT the erasure ends: it empties the booking on every fixture with no result,
     so an administrator not told leaves a match nobody is going to officiate. And nothing restores it. */
  it("arms a confirmation saying the row stays, unplayed fixtures need a new referee, and none of it comes back", async () => {
    render(underNext(h(FormAnonymisierenSection, PANEL_PROPS)));
    await userEvent.setup().click(screen.getByRole("button", { name: "Daten löschen" }));

    const angekuendigt = alarm() ?? "";
    assert.match(angekuendigt, /Zurückholen lässt sich das nicht/, "the armed confirmation does not refuse an undo in words");
    assert.match(angekuendigt, /Der Eintrag bleibt mit allen Spielen bestehen/, "the armed confirmation does not say the row survives");
    assert.match(angekuendigt, /Spiele ohne Ergebnis/, "the armed confirmation does not name the fixtures the erasure unassigns");
    assert.match(angekuendigt, /neuen Schiedsrichter/, "the armed confirmation does not say such a fixture needs somebody else");

    const armed = document.body.textContent.replace(/\s+/g, " ");
    assert.doesNotMatch(armed, /Rückgängig/, "the panel offers an undo, and no endpoint can honour one");
    assert.doesNotMatch(armed, /Telefonnummer[^.]*(auch|und überall)[^.]*Änderungsprotokoll/, "the panel narrows the log to the two fields");
    assert.doesNotMatch(armed, /behalten die Zuteilung|mit Namen/, "the armed confirmation promises what the erasure takes");
  });

  it("says in the action's report that a fixture without a result needs a new referee", () => {
    assert.match(ACTIONS, /Spiele ohne Ergebnis/, "the action's report does not name the fixtures the erasure unassigns");
    assert.match(ACTIONS, /neuen Schiedsrichter/, "the action's report does not say such a fixture needs somebody else");
    assert.ok(!/behalten die Zuteilung/.test(ACTIONS), "the action's report still promises the assignment survives the erasure");
  });

  /* `get_schiedsrichter` drops every stamped row whatever the query string asks for
     (`docs/backend/spec.md :: I227`), so a promise that „anonym“ stands in der Verwaltung sends an
     administrator looking for a row no read serves. */
  it("says the entry leaves the referee list rather than standing on it under another word", () => {
    const gezeigt = panelText();

    assert.match(gezeigt, /In der Schiedsrichterliste erscheint der Eintrag nicht mehr/, "the panel does not say the row leaves the list");
    assert.doesNotMatch(gezeigt, /In der Verwaltung/, "the panel still promises a word on the list the erasure empties");
  });

  /* A hand-write can leave a row nameless, and this panel is on that row's editor too: the sentence
     has to name a subject where the interpolated name is null. */
  it("names the subject of the deletion on a row that holds no name", () => {
    const gezeigt = namenlosPanelText();

    assert.match(gezeigt, /Telefonnummer von dieser Person\./, "the sentence deletes the details of nobody");
    assert.match(gezeigt, /[Aa]uf jedem gespielten Spiel/, "the nameless row's panel stopped saying which matches are reached");
  });

  /* Next to the deletion rather than instead of it: an administrator told only that the entry is
     stilled reports a retirement to the person who asked to be erased. */
  it("names the retirement beside the deletion rather than in place of it", () => {
    const gezeigt = panelText();

    assert.match(gezeigt, /stillgelegt/, "the confirmation does not say the entry stops taking fixtures");
    assert.match(gezeigt, /für neue Spiele nicht mehr angeboten/, "the confirmation does not say what the retirement costs");
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
});

describe("the erasure on the referee's editor", () => {
  it("arms before it writes", async () => {
    const user = userEvent.setup();
    renderEditor();

    await pressTwice(user, async () => {
      assert.deepEqual(aufrufe, [], "one press wrote");
      assert.match(alarm() ?? "", /^Bist Du Dir sicher\?/, "the escalation replaces the copy in place with no announcement");
    });
    assert.deepEqual(aufrufe, [{ action: "anonymiseSchiedsrichterAction", payload: { id: RECORD.id } }], "the second press writes nothing");
  });

  /* The refresh remounts the form onto the cleared record, so an unsaved draft goes with it, and the warning
     names that LOSS: a write-back is the opposite failure, the one no refresh at all causes. */
  it("refuses to arm over an unsaved draft, warning that the draft would be lost", async () => {
    const user = userEvent.setup();
    renderEditor();
    await typeADraft(user);
    await user.click(erasureButton());

    assert.equal(alarm(), null, "the erasure arms over an unsaved draft");
    const warnung = toasts.find(({ variant, title }) => variant === "warning" && title === "Erst speichern")?.description ?? "";
    assert.notEqual(warnung, "", "the refused press says nothing");
    // Three inflections of one verb: which one a sentence takes is its grammar rather than its meaning.
    assert.match(warnung, /verwirft|verwerfen|verworfen/, "the guard does not say the unsaved changes are lost");
    assert.doesNotMatch(warnung, /zurück|wieder ein/, "the guard describes a write-back the page's key rules out");
  });

  // Judged on both presses: a draft opened after the first is lost to the second just the same.
  it("refuses the second press over a draft opened after the first", async () => {
    const user = userEvent.setup();
    renderEditor();

    await pressTwice(user, async () => {
      assert.notEqual(alarm(), null, "a clean editor does not arm, so nothing below is judged");
      await typeADraft(user);
    });
    assert.deepEqual(aufrufe, [], "the second press writes over a draft opened after the first");
  });

  /* The STORED record, never the draft: this write clears what is saved, and a readout off typed
     values would name data the press does not reach. */
  it("reads the stored contact record", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(erasureButton());
    await user.clear(screen.getByRole("textbox", { name: "E-Mail" }));
    await user.type(screen.getByRole("textbox", { name: "E-Mail" }), "neu@example.de");

    assert.match(alarm() ?? "", /anna@example\.de/, "the armed readout names no stored address");
    assert.doesNotMatch(alarm() ?? "", /neu@example\.de/, "the armed readout names the typed address the press does not reach");
  });

  /* Both halves or neither: without the key the refresh remounts nothing, and without the refresh the boxes
     keep the deleted values and the next save writes them back. The referee survives, so nothing leaves the page. */
  it("refreshes after the write onto a view the page keys on the record, and stays on the page", async () => {
    antworte(() => Promise.resolve({ success: true, message: "Die Daten sind gelöscht." }));
    renderEditor();
    await pressTwice(userEvent.setup());

    assert.deepEqual(
      toasts.map(({ variant, title }) => [variant, title]),
      [["success", "Schiedsrichterdaten gelöscht"]],
      "the write answered without its toast, so nothing below is judged",
    );
    assert.deepEqual(navigiert, ["refresh"], "the cleared record never reaches the form, or the page is left");
    assert.match(PAGE, /key=\{JSON\.stringify\(schiedsrichter\)\}/, "the view no longer remounts when the record changes");
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
    assert.doesNotMatch(
      panelText(),
      /Telefonnummer[^.]*(auch|und überall)[^.]*Änderungsprotokoll/,
      "the panel narrows the log to the two fields",
    );
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

/**
 * Each action's own source, comments blanked and ended at the NEXT declaration of any kind, so a
 * helper standing between two exports cannot answer for the one above it. Blanking can swallow a
 * real call; it cannot invent one.
 */
const BARE_ACTIONS = ACTIONS.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " ")).replace(/^[ \t]*\/\/[^\n]*$/gm, "");
const DECLARATIONS = [...BARE_ACTIONS.matchAll(/^(export )?(?:async )?function (\w+)/gm)];
const ACTION_BODIES = new Map<string, string>(
  DECLARATIONS.flatMap((match, index): [string, string][] =>
    match[1] === undefined ? [] : [[match[2] ?? "", BARE_ACTIONS.slice(match.index, DECLARATIONS[index + 1]?.index)]],
  ),
);

/** The mutation callback's own top level: a call one block deeper runs on a branch rather than on every path out. */
const TOP_LEVEL_REFRESH = /^ {4}refresh\(\);$/m;

/** Every action this slice exports, all of them writes. A new one fails the sweep until it is placed. */
const WRITE_ACTIONS = [
  "postSchiedsrichterAction",
  "patchSchiedsrichterAction",
  "deleteSchiedsrichterAction",
  "reactivateSchiedsrichterAction",
  "anonymiseSchiedsrichterAction",
];

describe("the refresh a write owes the list the admin is looking at", () => {
  it("places every action the slice exports, each in the callback the case below reads", () => {
    assert.deepEqual([...ACTION_BODIES.keys()], WRITE_ACTIONS, "an action arrived or left without being placed as a write");
    for (const name of WRITE_ACTIONS) {
      assert.ok(
        ACTION_BODIES.get(name)?.includes(`\n  return runAdminMutation("${name}", async () => {\n`),
        `${name} opens some other callback, so the indentation the next case reads means nothing`,
      );
    }
  });

  it("refreshes on every one of them, the referee list being uncached and no tag reaching it", () => {
    for (const name of WRITE_ACTIONS) {
      const body = ACTION_BODIES.get(name) ?? "";
      const refreshAt = body.search(TOP_LEVEL_REFRESH);
      assert.notEqual(refreshAt, -1, `${name} writes and leaves the admin's list standing`);
      assert.ok(refreshAt < body.indexOf("success: true"), `${name}'s success return does not stand after a refresh`);
    }
  });
});
