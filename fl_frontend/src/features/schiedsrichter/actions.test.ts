import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, it, mock } from "node:test";

import { createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { DOUBLE_PRESS_MS } from "@/shared/hooks/useTwoPressConfirm.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { declaredCodes, sliceBetween } from "@/shared/testing/refusalRegister.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import { SCHIEDSRICHTER_ANONYM_LABEL } from "./constants.ts";

import type { ReactNode } from "react";

/* Every write hangs until a case answers it: a real action needs a session and a backend. */
const { calls, answerWith } = doubleActions({
  modules: ["/src/features/schiedsrichter/actions.ts"],
  answer: () => new Promise<never>(() => undefined),
});

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { FormAnonymisierenSection } = await import("./components/forms/AdminSchiedsrichterEditForm/FormAnonymisierenSection.tsx");
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
const ANONYMISE_CODES = ["REQ-ANONYMISE-004"];

/* The anonymisation is the last declaration in the module, so its slice runs to the end of the file. */
const ANONYMISE_ACTION = sliceBetween(ACTIONS, "export async function anonymiseSchiedsrichterAction", null);
/* Read per slice rather than over the file: three mappers live here, and a search over the whole source
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

/* The first mapper in the module, so its slice ends where the retire's begins. */
const NAME_MAP = sliceBetween(ACTIONS, "function mapNameRefusal", "function mapRetireRefusal");
const GESPERRT_MAP = sliceBetween(ACTIONS, "function mapGesperrteAdresseRefusal", "const STILLGELEGT_OHNE_LINK");
const STILLGELEGT_MAP = sliceBetween(ACTIONS, "function mapStillgelegtRefusal", "function mapEinladenRefusal");
const EINLADEN_MAP = sliceBetween(ACTIONS, "function mapEinladenRefusal", "const SCHON_BESTAETIGT");
/** The referee's OWN link is read rather than written by an admin action, so its German sits here. */
const QUERIES = readFileSync(path.resolve(import.meta.dirname, "queries.ts"), "utf8");
const CREATE_ACTION = sliceBetween(
  ACTIONS,
  "export async function postSchiedsrichterAction",
  "export async function patchSchiedsrichterAction",
);
/* The venue's copy of the same sentence, read where it is written rather than retyped here. */
const SPIELORTE_ACTIONS = readFileSync(path.resolve(import.meta.dirname, "..", "spielorte", "actions.ts"), "utf8");

/** The route that REPLAYS the save, whose German is the third site `.claude/rules/cross-surface.md` names. */
const UNDO_ROUTE = readFileSync(
  path.resolve(REPO_ROOT, "fl_frontend", "src", "app", "api", "admin", "schiedsrichter", "undo", "route.ts"),
  "utf8",
);

const REACTIVATE_ACTION = sliceBetween(
  ACTIONS,
  "export async function reactivateSchiedsrichterAction",
  "export async function anonymiseSchiedsrichterAction",
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

    assert.ok(REACTIVATE_ACTION.includes("reactivateSchiedsrichter(validated.data)"), "the reactivation's call is outside its slice");
  });

  /* The ghost is the one refusal here, and it needs a sentence: an administrator reaches this only by
     opening the row every erased referee's fixtures point at. A rule declared later and left unmapped
     fails this. */
  it("maps every refusal its endpoint declares", () => {
    const declared = declaredCodes(ANONYMISE_OPERATION);

    // Asserted before the loop: a register that stopped naming the operation runs it zero times, green.
    assert.deepEqual(declared, ANONYMISE_CODES);
    for (const code of declared)
      assert.ok(ANONYMISE_MAP.includes(`serverErrorCode === "${code}"`), `${code} reaches the admin as an unhandled conflict`);

    assert.ok(ANONYMISE_ACTION.includes("mapAnonymiseRefusal(error)"), "the anonymisation consults some other mapper");
    assert.ok(!ANONYMISE_ACTION.includes("mapRetireRefusal"), "the retire's refusal is reported about a contact deletion");
  });

  /* The reactivation declares nothing and the undo replays the save: a rule added to either and left
     unmapped reaches the admin as the 409 fallback, which names an entry rather than a rule. */
  it("leaves the reactivation with no refusal of its own to word", () => {
    assert.deepEqual(declaredCodes("POST /schiedsrichter/{schiedsrichter_id}/reactivate"), []);
    assert.ok(!REACTIVATE_ACTION.includes("serverErrorCode"), "the reactivation words a refusal its endpoint no longer declares");
  });

  /* The replay meets the ban list exactly as the save does, and the shared 409 fallback would tell
     the administrator an equivalent entry exists (`.claude/rules/cross-surface.md`). */
  it("words the ban the replayed save can be refused on, at the undo route too", () => {
    for (const code of declaredCodes("PATCH /schiedsrichter/{schiedsrichter_id}")) {
      assert.ok(UNDO_ROUTE.includes(code), `${code} reaches the admin through the undo as an unhandled conflict`);
    }
  });

  /* Both writes mint where an address was given, so both meet the ban list, and one mapper words it
     for the box that holds the value the list refused. */
  it("maps every refusal the create and the save declare, on the box that owes the link", () => {
    assert.deepEqual(declaredCodes("POST /schiedsrichter"), ["REQ-SCHIEDSRICHTER-007"]);
    assert.deepEqual(declaredCodes("PATCH /schiedsrichter/{schiedsrichter_id}"), ["REQ-SCHIEDSRICHTER-001", "REQ-SCHIEDSRICHTER-007"]);

    assert.ok(
      GESPERRT_MAP.includes(`serverErrorCode === "REQ-SCHIEDSRICHTER-007"`),
      "the banned address reaches the admin as an unhandled conflict",
    );
    assert.ok(GESPERRT_MAP.includes(`"kontakt.email"`), "the ban lands anywhere but the box that holds the refused address");
    assert.ok(
      STILLGELEGT_MAP.includes(`serverErrorCode === "REQ-SCHIEDSRICHTER-001"`),
      "the retirement reaches the admin as an unhandled conflict",
    );
    assert.ok(STILLGELEGT_MAP.includes(`"kontakt.email"`), "the retirement lands anywhere but the box whose change owes the link");
  });

  /* Every refusal the re-send declares, worded at the panel: nothing there is a form, so each is a
     sentence rather than a field error. */
  it("words every refusal the re-send declares", () => {
    const declared = declaredCodes("POST /schiedsrichter/{schiedsrichter_id}/bestaetigung/einladen");

    // Asserted before the loop: a register that stopped naming the operation runs it zero times, green.
    assert.deepEqual(declared, ["REQ-SCHIEDSRICHTER-001", "REQ-SCHIEDSRICHTER-004", "REQ-SCHIEDSRICHTER-006", "REQ-SCHIEDSRICHTER-007"]);
    for (const code of declared) assert.ok(EINLADEN_MAP.includes(`case "${code}"`), `${code} reaches the admin as an unhandled conflict`);
  });

  /* The public page's own two endpoints. Their German is the visitor's, so it is worded where the
     page reads them rather than in an admin action's mapper. */
  it("words every refusal the referee's own link declares", () => {
    const declared = [...declaredCodes("POST /schiedsrichter/bestaetigung"), ...declaredCodes("POST /schiedsrichter/bestaetigung/ansicht")];

    assert.ok(declared.length >= 4, `expected the link's four refusals, found ${String(declared.length)}`);
    for (const code of new Set(declared)) assert.ok(QUERIES.includes(`case "${code}"`), `${code} reaches the visitor as an unhandled conflict`);
  });

  it("leaves the retirement's own refusal on the retirement", () => {
    assert.deepEqual(declaredCodes("DELETE /schiedsrichter/{schiedsrichter_id}"), ["REQ-RETIRE-004"]);
    assert.ok(RETIRE_ACTION.includes("mapRetireRefusal(error)"), "the retire stopped consulting its mapper");
    assert.ok(!RETIRE_ACTION.includes("mapAnonymiseRefusal"), "the contact deletion's refusal is reported about a retirement");
  });

  /* These administrators are teachers, and the one thing this sentence must not do is suggest a way
     back: the person's row is gone, so the repair names the referee they meant instead. */
  it("words the ghost's refusal without offering a retry on it", () => {
    assert.match(ANONYMISE_MAP, /keine Person/, "the refusal does not say why this entry cannot be erased");
    assert.doesNotMatch(ANONYMISE_MAP, /wiederherstell|zurückhol|rückgängig|erneut/i, "the refusal offers a retry on a row that holds nobody");
  });
});

describe("the referee name a unique index already holds", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/shared/testing/refusalRegister.ts :: sliceBetween`). */
  it("cuts the mapper and the create out of the file before reading them", () => {
    assert.ok(NAME_MAP.includes("serverErrorCode"), "the duplicate name's arm is outside its slice");
    assert.ok(!NAME_MAP.includes("REQ-RETIRE-004"), "the duplicate name's slice runs on into the retire's mapper");

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

  /* The unique index is the only 409 either write raises now, so both consult this mapper and nothing
     else: one left unmapped drops the duplicate into the conflict fallback, which names no box. */
  it("consults the mapper on the create and on the edit", () => {
    assert.ok(CREATE_ACTION.includes("mapNameRefusal(error)"), "the create consults no mapper, so a duplicate name reaches the error page");
    assert.ok(RENAME_ACTION.includes("mapNameRefusal(error)"), "the edit consults no mapper, so a duplicate name reaches the error page");
  });

  /* One sentence for both slices: a reader meets the same box on four forms, and a rewording of one
     copy would tell two of them something the other two do not say. */
  it("words a venue's duplicate name the same way", () => {
    assert.match(SPIELORTE_ACTIONS, /fieldErrors: \{ name: "Diesen Namen gibt es schon\." \}/, "the two slices word one refusal apart");
  });
});

describe("what the anonymisation moves", () => {
  /* The one cached read it moves: the repointed booking lands on every Spiel as a rename does, and without
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
const { router, seen } = recordingRouter();

const underRecordingNext = (tree: ReactNode): ReactNode => underNext(tree, { router });

/** The sentences a reader hears, tags gone and the JSX line breaks collapsed. */
const read = (element: ReactNode): string =>
  textOf(renderTree(underRecordingNext(element)))
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
const panelText = (): string => read(h(FormAnonymisierenSection, PANEL_PROPS));

/** The same panel over a row a hand-write left nameless, which the editor serves like any other. */
const namelessPanelText = (): string =>
  read(h(FormAnonymisierenSection, { ...PANEL_PROPS, name: null, schule: null, kontakt: { email: null, telefon: null } }));

const RECORD = {
  id: "68c1f0a2b3c4d5e6f7a8b9c0",
  name: "Anna Beispiel",
  schule: "Musterschule",
  kontakt: { email: "anna@example.de", telefon: "069 1234567" },
  default_payment: 25,
  geburtsdatum: null,
  einwilligung: null,
  bestaetigung: null,
};

/** What the save answers where the address of an outstanding referee moved and the link went out. */
const VERSAND_SATZ = "Der Best\u00e4tigungslink ging an anna@example.de.";

afterEach(() => {
  calls.length = 0;
  toasts.length = 0;
  seen.pushed.length = 0;
  seen.replaced.length = 0;
  seen.refresh = 0;
  answerWith(() => new Promise<never>(() => undefined));
});

/** The editor the page mounts for a referee nobody erased, whose last panel is the erasure. */
const renderEditor = () => render(underRecordingNext(h(AdminSchiedsrichterEditView, { schiedsrichter: RECORD, inactiveSince: null })));

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
  /* The ROW does not survive and the FIXTURES do. Copy saying the entry stays, or that a reader can
     open it afterwards, describes an operation the backend no longer runs. */
  it("says the entry goes whole and the fixtures stay under one word", () => {
    const shown = panelText();

    assert.match(shown, /vollständig aus der Verwaltung/, "the confirmation does not say the entry goes whole");
    assert.match(shown, /Änderungsprotokoll/, "the confirmation does not say the log is reached");
    assert.match(shown, /Spiele selbst bleiben/, "the confirmation does not say the fixtures survive the person");
    assert.doesNotMatch(shown, /Eintrag bleibt|bearbeiten lässt|stillgelegt/, "the confirmation promises a row the erasure deletes");
  });

  /* The subject is what an administrator is left holding: the person is gone, the fixtures are not,
     and one of them may now need somebody. Nothing restores any of it. */
  it("arms a confirmation saying the entry goes, the fixtures stay, and none of it comes back", async () => {
    render(underRecordingNext(h(FormAnonymisierenSection, PANEL_PROPS)));
    await userEvent.setup().click(screen.getByRole("button", { name: "Daten löschen" }));

    const announced = alarm() ?? "";
    assert.match(announced, /Zurückholen lässt sich das nicht/, "the armed confirmation does not refuse an undo in words");
    assert.match(announced, /Eintrag verschwindet ganz/, "the armed confirmation does not say the entry goes whole");
    assert.match(announced, /Spiele ohne Ergebnis/, "the armed confirmation does not name the fixtures that need somebody");
    assert.match(announced, /neuen Schiedsrichter/, "the armed confirmation does not say such a fixture needs somebody else");

    const armed = document.body.textContent.replace(/\s+/g, " ");
    /* The readout stands only once armed, and the school is the field an administrator forgets: beside a
       fixture list that never expires it narrows the person to the few referees one school ever sent. */
    assert.match(armed, /Schule \/ Verein/, "the readout does not name the school among what goes");
    assert.doesNotMatch(armed, /Rückgängig/, "the panel offers an undo, and no endpoint can honour one");
    assert.doesNotMatch(armed, /Telefonnummer[^.]*(auch|und überall)[^.]*Änderungsprotokoll/, "the panel narrows the log to the two fields");
    assert.doesNotMatch(armed, /Eintrag bleibt|behalten die Zuteilung/, "the armed confirmation promises what the erasure takes");
  });

  it("says in the action's report that a fixture without a result needs a new referee", () => {
    assert.match(ACTIONS, /Spiele ohne Ergebnis/, "the action's report does not name the fixtures the erasure unassigns");
    assert.match(ACTIONS, /neuen Schiedsrichter/, "the action's report does not say such a fixture needs somebody else");
    assert.ok(!/behalten die Zuteilung/.test(ACTIONS), "the action's report still promises the assignment survives the erasure");
  });

  /* A hand-write can leave a row nameless, and this panel is on that row's editor too: the sentence
     has to name a subject where the interpolated name is null. */
  it("names the subject of the deletion on a row that holds no name", () => {
    const shown = namelessPanelText();

    assert.match(shown, /Eintrag von dieser Person/, "the sentence deletes the entry of nobody");
    assert.match(shown, /diese Person geleitet hat/, "the nameless row's panel stopped saying which matches are reached");
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

describe("what the save tells the administrator about the message it sent", () => {
  /* The save mails a link where an outstanding referee's address moved, and the editor's toast is
     the one surface that can say so: the page it returns to shows no send. */
  it("carries the send's own sentence into the undo offer", async () => {
    answerWith(() =>
      Promise.resolve({ success: true, updated_document: null, message: "Schiedsrichter bearbeitet", versandSatz: VERSAND_SATZ }),
    );

    const user = userEvent.setup();
    renderEditor();
    // The save bar is closed on a clean draft, so the press needs a change to commit — and one the
    // rail raises no blocking banner over, which would open the confirmation dialog instead.
    await user.type(screen.getByRole("textbox", { name: /Schule/ }), "n");
    await user.click(screen.getAllByRole("button", { name: "Speichern" })[0]!);
    // The write runs inside a transition, so the press returns before the offer is raised.
    await waitFor(() => {
      assert.ok(toasts.length > 0, "the save raised no toast at all");
    });

    assert.deepEqual(
      toasts.map((raised) => [raised.variant, raised.title, raised.description]),
      [["success", "\u00c4nderung gespeichert", VERSAND_SATZ]],
    );
  });

  /* A link that did not leave is collateral rather than a clean save: the referee has no working
     link, and nobody else is told. */
  it("grades a failed send a warning", async () => {
    answerWith(() =>
      Promise.resolve({
        success: true,
        updated_document: null,
        message: "Schiedsrichter bearbeitet",
        versandSatz: VERSAND_SATZ,
        versandFehlgeschlagen: true,
      }),
    );

    const user = userEvent.setup();
    renderEditor();
    // The save bar is closed on a clean draft, so the press needs a change to commit — and one the
    // rail raises no blocking banner over, which would open the confirmation dialog instead.
    await user.type(screen.getByRole("textbox", { name: /Schule/ }), "n");
    await user.click(screen.getAllByRole("button", { name: "Speichern" })[0]!);
    // The write runs inside a transition, so the press returns before the offer is raised.
    await waitFor(() => {
      assert.ok(toasts.length > 0, "the save raised no toast at all");
    });

    assert.deepEqual(
      toasts.map((raised) => [raised.variant, raised.title]),
      [["warning", "Mit Folgen gespeichert"]],
    );
  });

  it("falls back to the editor's own sentence where the save mailed nothing", async () => {
    answerWith(() => Promise.resolve({ success: true, updated_document: null, message: "Schiedsrichter bearbeitet" }));

    const user = userEvent.setup();
    renderEditor();
    // The save bar is closed on a clean draft, so the press needs a change to commit — and one the
    // rail raises no blocking banner over, which would open the confirmation dialog instead.
    await user.type(screen.getByRole("textbox", { name: /Schule/ }), "n");
    await user.click(screen.getAllByRole("button", { name: "Speichern" })[0]!);
    // The write runs inside a transition, so the press returns before the offer is raised.
    await waitFor(() => {
      assert.ok(toasts.length > 0, "the save raised no toast at all");
    });

    assert.deepEqual(
      toasts.map((raised) => [raised.variant, raised.description]),
      [["success", "Die Schiedsrichterdaten wurden aktualisiert."]],
    );
  });
});

describe("the erasure on the referee's editor", () => {
  it("arms before it writes", async () => {
    const user = userEvent.setup();
    renderEditor();

    await pressTwice(user, async () => {
      assert.deepEqual(calls, [], "one press wrote");
      assert.match(alarm() ?? "", /^Bist Du Dir sicher\?/, "the escalation replaces the copy in place with no announcement");
    });
    assert.deepEqual(calls, [{ action: "anonymiseSchiedsrichterAction", payload: { id: RECORD.id } }], "the second press writes nothing");
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
    assert.deepEqual(calls, [], "the second press writes over a draft opened after the first");
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

  /* The row is deleted by the time this lands, so the page the panel stands on answers not-found: a
     refresh would put the admin on that page, and a push would leave Back pointing at it. */
  it("leaves the page it just deleted, by replacing it rather than pushing", async () => {
    answerWith(() => Promise.resolve({ success: true, message: "Die Daten sind gelöscht." }));
    renderEditor();
    await pressTwice(userEvent.setup());

    assert.deepEqual(
      toasts.map(({ variant, title }) => [variant, title]),
      [["success", "Schiedsrichterdaten gelöscht"]],
      "the write answered without its toast, so nothing below is judged",
    );
    assert.deepEqual(seen.replaced, ["/admin/schiedsrichter"], "the erasure stays on the page whose row it deleted");
    assert.deepEqual(seen.pushed, [], "Back is left pointing at a page that now answers not-found");
    assert.equal(seen.refresh, 0, "the erasure re-reads a row it has deleted");
  });

  /* A rename is the surviving write on this page, and the draft mirrors the stored record: without
     the key the saved values never reach the boxes and the form reads as dirty against them. */
  it("keys the editor on the stored record, so a save remounts it", () => {
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
