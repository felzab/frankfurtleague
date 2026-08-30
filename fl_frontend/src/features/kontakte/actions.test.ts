import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { declaredCodes, sliceBetween } from "../../core/refusalRegister.ts";
import { describeKontaktErasureUmfang } from "./utils.ts";

import type { FLKontaktErasureResponse } from "./schemas.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");
const MUTATIONS = readFileSync(path.resolve(import.meta.dirname, "mutations.ts"), "utf8");
const SCHEMAS = readFileSync(path.resolve(import.meta.dirname, "schemas.ts"), "utf8");
const PANEL_SOURCE = readFileSync(path.resolve(import.meta.dirname, "components", "forms", "AdminKontaktErasureForm.tsx"), "utf8");
/** Whitespace-collapsed: the panel's copy is JSX text, so the formatter picks its line breaks. */
const PANEL = PANEL_SOURCE.replace(/\s+/g, " ");
/** The page the control stands on, collapsed for the same reason. */
const PAGE_SOURCE = readFileSync(path.resolve(REPO_ROOT, "fl_frontend", "src", "app", "admin", "kontakte", "page.tsx"), "utf8");
const SECTION = readFileSync(
  path.resolve(import.meta.dirname, "components", "forms", "AdminKontakteEditForm", "FormKontakteSection.tsx"),
  "utf8",
).replace(/\s+/g, " ");
const PAGE = PAGE_SOURCE.replace(/\s+/g, " ");
/** The backend redaction the panel's copy describes, read where it is written. */
const RECORDING = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "core", "recording.py"), "utf8");

const ERASURE_OPERATION = "POST /kontakte/erasure";

/* Each declaration is cut at the one named after it, the header above the first included: a boundary
   that stopped matching then fails the case pinning the cut rather than every case reading the slice. */
const ERASE_ACTION = sliceBetween(ACTIONS, "export async function eraseKontaktpersonAction", " * The three seats one club holds");
const ACTION_HEADER = sliceBetween(ACTIONS, '"use server"', "export async function eraseKontaktpersonAction");
/* The erasure's own half of `mutations.ts`. Cut, because the module holds the seats' write too, and
   an assertion over the whole file would answer about whichever of the two moved last. */
const ERASE_MUTATION = sliceBetween(MUTATIONS, "export async function eraseKontaktperson", "// Both ids go in the PATH");
/* The panel's handlers, read as written rather than collapsed: what is asserted over them is code,
   and each is cut at the next declaration so a statement smuggled in between fails a case below. */
const ADDRESS_CHANGE = sliceBetween(PANEL_SOURCE, "const handleAddressChange", "/** The write itself");
const COMMIT = sliceBetween(PANEL_SOURCE, "const commit = async", "const handleErase =");
const HANDLE_ERASE = sliceBetween(PANEL_SOURCE, "const handleErase =", "/**");
const HANDLE_ARM = sliceBetween(PANEL_SOURCE, "const handleArm =", "return (");
const JUDGE_ADDRESS = sliceBetween(PANEL_SOURCE, "const judgeAddress", "const { isConfirming");
const RESPONSE_SCHEMA = sliceBetween(SCHEMAS, "export const FLKontaktErasureResponseSchema", null);

/**
 * One function body's statements, comments and blank lines dropped. What the text tests below can
 * assert is the SHAPE of a handler; that it behaves is not reachable from here, and is said so at
 * each case rather than dressed up in a longer regex.
 */
function statementsOf(slice: string): string[] {
  return slice
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("/*") && !line.startsWith("*"));
}

/** One response, spelled once so a report case names only the figures it is about. */
function erasure(counts: Partial<Omit<FLKontaktErasureResponse, "acknowledged">>): FLKontaktErasureResponse {
  return {
    acknowledged: 1,
    cleared_saison_teams: 0,
    cleared_bewerbungen: 0,
    cleared_kontakt_slots: 0,
    redacted_aktionen: 0,
    ...counts,
  };
}

describe("the erasure against the backend's refusal register", () => {
  /* First, because a boundary string that stopped matching leaves the slices empty and every
     assertion over them would then fail for something that is not the defect. */
  it("cuts the action out of the file before reading it", () => {
    assert.ok(ERASE_ACTION.includes("eraseKontaktperson(validated.data)"), "the erasure's call is outside its slice");
    assert.ok(!ERASE_ACTION.includes("import {"), "the erasure's slice reaches back over the module's imports");
    assert.ok(!ERASE_ACTION.includes("patchSaisonTeamKontakte("), "the erasure's slice runs on into the seats' write");
    assert.ok(ERASE_MUTATION.includes('"/kontakte/erasure"'), "the erasure's mutation is outside its slice");
    assert.ok(!ERASE_MUTATION.includes("/saisons/"), "the erasure's mutation slice runs on into the seats' write");
    assert.ok(
      ACTION_HEADER.includes('eraseKontaktperson, patchSaisonTeamKontakte } from "./mutations"'),
      "the header's slice no longer holds the import",
    );
    assert.notEqual(ADDRESS_CHANGE, "", "the panel's change handler is no longer where the cut looks for it");
    assert.ok(COMMIT.includes("await eraseKontaktpersonAction("), "the write's own slice does not reach the call");
    assert.ok(!COMMIT.includes("press("), "the write's slice reaches the presses that dispatch it");
    assert.ok(HANDLE_ERASE.includes("press("), "the press handler's slice does not reach its dispatch");
    assert.ok(HANDLE_ARM.includes("isConfirming"), "the arm handler's slice does not reach its guard");
    assert.ok(JUDGE_ADDRESS.includes("guardSubmit"), "the address guard's slice does not reach its block");
    assert.ok(RESPONSE_SCHEMA.includes("redacted_aktionen"), "the response schema's slice does not reach its fields");
  });

  /* The endpoint refuses nothing: a person may want their details gone while the club they were
     reached for still plays. A rule declared against it later fails here, rather than reaching the
     admin unmapped. */
  it("has no refusal to map, and maps none", () => {
    assert.deepEqual(declaredCodes(ERASURE_OPERATION), []);
    assert.ok(!ERASE_ACTION.includes("serverErrorCode"), "the erasure maps a code its endpoint does not answer");
    assert.ok(!ERASE_ACTION.includes("APIBadStatusError"), "the erasure catches a refusal its endpoint does not raise");
  });

  /* The floor under the case above: an empty list has to mean "this endpoint declares none" rather
     than "the register was read as nothing at all". */
  it("reads a declared refusal where one exists", () => {
    assert.deepEqual(declaredCodes("DELETE /spieler/{spieler_id}/erasure"), ["REQ-PURGE-001"]);
  });
});

describe("what the erasure moves", () => {
  /* No cached read holds a contact person: the memberships read is admin-tier and memoised per
     render pass, the public team reads carry no `kontakte` at all, and the applications and the log
     are uncached too. */
  it("invalidates nothing, and says why", () => {
    assert.ok(!ACTIONS.includes("updateTag("), "a contacts write clears a cached read its endpoint does not move");
    assert.ok(!ACTIONS.includes('from "next/cache"'), "a contacts write reaches the cache API for something");
    // Both of the module's writes, so a second one added without the reasoning fails here.
    assert.equal([...ACTIONS.matchAll(/Nothing to invalidate/g)].length, 2, "an absent invalidation is left unexplained");
  });

  /* The address travels in the BODY. A path or a query segment would file it in the access log, in
     nginx's log and in `aktionen.request.path` — three fresh copies of the value being destroyed. */
  it("sends the address in the body, to the erasure endpoint, as a POST", () => {
    assert.match(ERASE_MUTATION, /"\/kontakte\/erasure"/, "the mutation no longer addresses the erasure endpoint");
    assert.match(ERASE_MUTATION, /FLKontaktErasureResponseSchema,\s*\{\s*method: "POST"/, "the erasure is sent as something other than a POST");
    assert.match(ERASE_MUTATION, /body: JSON\.stringify\(payload\)/, "the payload no longer travels in the body");
    assert.ok(!ERASE_MUTATION.includes("params:"), "the address is sent as a query parameter, which the access log keeps");
    assert.ok(!/\$\{[^}]*\}/.test(ERASE_MUTATION), "the endpoint interpolates a value into the path");
  });

  /* The admin tier is what `apiClient` sends `X-FL-Actor` on, so any other tier is refused 401 and
     unattributable both. Read as TEXT: this module is `server-only`, so nothing here can call it and
     observe the header. */
  it("leaves at the admin tier and at no other", () => {
    // Every write in the module, not the erasure alone: both are admin-tier and a second one added
    // at any other tier is refused 401 and unattributable both.
    const tiers = [...MUTATIONS.matchAll(/authType: "(\w+)"/g)].map((match) => match[1]);

    assert.deepEqual(tiers, ["admin", "admin"], `the module's writes are sent at: ${tiers.join(", ") || "no tier at all"}`);
  });

  /* The response carries counts and no person, and nothing on this side may put one back. */
  it("reports counts and never the address", () => {
    assert.ok(!RESPONSE_SCHEMA.includes("email"), "the response mirror carries an address the endpoint withholds");
    assert.ok(!/\bemail\b/.test(ERASE_ACTION), "the action's own report reads the address it was handed");
    assert.match(ERASE_ACTION, /message: describeKontaktErasureUmfang\(erasure\)/, "the report is composed somewhere else now");
  });

  /* Enumerated rather than pattern-matched: the FAILURE path is where an echo would go unnoticed, so
     every statement of the write touching the address is listed and a fourth one fails here. */
  it("touches the address in three places on the write path, and in no toast", () => {
    // A substring rather than a word boundary, so `setEmail` is on the list too.
    const addressLines = statementsOf(COMMIT).filter((line) => /email/i.test(line));

    assert.deepEqual(addressLines, [
      "const res = await eraseKontaktpersonAction({ email });",
      "if (hasFieldErrors(res.fieldErrors)) setSubmitFieldErrors(res.fieldErrors, { erasure: { email } });",
      'setEmail("");',
    ]);
    assert.match(
      COMMIT,
      /appToast\.danger\("Kontaktperson nicht gelöscht", \{ description: res\.error \?\? UNKNOWN_REFUSAL \}\);/,
      "the failure toast says something other than the refusal it was handed",
    );
    /* The zero branch, as the editor's own control takes it: the endpoint refuses nothing, so an
       address matching nobody succeeds and clears zero, and „gelöscht“ over that is a quiet lie. */
    assert.match(
      COMMIT,
      /if \(res\.cleared === 0\) appToast\.warning\("Nichts gefunden", \{ description: res\.message \}\);/,
      "a write that found nothing is reported as a deletion",
    );
    assert.match(
      COMMIT,
      /else appToast\.success\("Kontaktperson gelöscht", \{ description: res\.message \}\);/,
      "the success toast says something other than the action's report",
    );

    /* The referee anonymisation already owns „Kontaktdaten gelöscht“, and two different writes under
       one title read as one thing having happened. */
    assert.ok(!COMMIT.includes("Kontaktdaten gelöscht"), "the erasure took the anonymisation's title");
  });

  /* One call site, so nothing reaches the endpoint around the confirm: a `press`-less second call
     would arm nothing and write at once, which is the shape a stray dispatch takes. */
  it("is reachable from exactly one place in the panel", () => {
    const calls = [...PANEL_SOURCE.matchAll(/eraseKontaktpersonAction\(/g)].length;

    assert.equal(calls, 1, `the panel reaches the erasure from ${String(calls)} places`);
    assert.deepEqual(statementsOf(HANDLE_ERASE), ["const handleErase = () => press(commit);"], "the press handler grew a second statement");
  });
});

describe("the erasure's copy", () => {
  it("says what goes, in the rows and in the log", () => {
    assert.match(PANEL, /jeden Kontakteintrag mit dieser E-Mail-Adresse/, "the panel does not name what is emptied");
    assert.match(PANEL, /in jeder Saison und in jeder Bewerbung/, "the panel does not say how far the erasure reaches");
    assert.match(PANEL, /gesicherte[rn]? Stand/, "the panel does not name the pre-image the log keeps");
    assert.ok(!PANEL.includes("Rückgängig"), "the panel offers an undo, and no endpoint can honour one");
  });

  /* `build_redaction_update` nulls `before`, the WHOLE pre-image of every row naming a reached row.
     An unrelated edit to that row loses its image too, so copy narrowing this to the contact details
     describes a smaller write. */
  it("matches what the redaction actually clears", () => {
    assert.match(RECORDING, /def build_redaction_update[\s\S]*?"before": None/, "the backend no longer clears the whole pre-image");
    assert.match(
      PANEL,
      /Das gilt auch für Zeilen, in denen es um etwas ganz anderes ging, etwa um eine Trikotfarbe oder einen Gruppenwechsel/,
      "the panel narrows the redaction to rows about a contact entry",
    );
    assert.doesNotMatch(PANEL, /die einen dieser Einträge betrifft/, "the panel narrows the redaction's reach to the entries themselves");
  });

  /* What survives is as load-bearing as what goes: the rows stay, so the log still shows that
     something happened and when, and the two people beside the erased one are untouched. */
  it("says what stays", () => {
    assert.match(PANEL, /Was wann geschehen ist, bleibt lesbar/, "the panel does not say what the log keeps");
    assert.match(PANEL, /Die anderen Kontaktpersonen beim selben Team bleiben eingetragen/, "the panel does not spare the people beside them");
    assert.match(PANEL, /Das Team und die Saison bleiben bestehen/, "the armed state does not say the club and the season survive");
  });

  /* The two beside them survive in the LIVE row and not in the log, whose whole image goes. The
     qualification belongs in the reveal: the body's warning sits a paragraph above the last thing
     read before the press. */
  it("qualifies the reassurance where the reveal gives it", () => {
    const reveal = sliceBetween(PANEL, "Zurückholen lässt sich das nicht.", "</p>");

    assert.notEqual(reveal, "", "the reveal's closing paragraph is no longer where the cut looks for it");
    assert.match(reveal, /Die anderen Kontaktpersonen bleiben eingetragen/, "the reveal drops what survives the press");
    // Never „die beiden anderen“: `trainer_ist_zugleich` seats one person in two slots, so an
    // erasure can leave one other person rather than two.
    assert.ok(!PANEL.includes("beiden anderen"), "the copy counts the survivors, and a double-seated person makes it one");
    assert.match(reveal, /Ihr gesicherter Stand im Änderungsprotokoll geht aber mit/, "the reveal spares the two beside them in the log too");
    assert.ok(!reveal.includes("bleiben unberührt"), "the reveal calls the two beside them untouched, which the log makes false");
  });

  /* The club and the season are reached by nothing here: the SLOT is nulled and never the block, and
     no season row is removed. Copy claiming otherwise would describe a write the backend refuses. */
  it("never claims the club, the season or the application is removed", () => {
    for (const claim of ["Team wird gelöscht", "Saison wird gelöscht", "Bewerbung wird gelöscht", "Team endgültig löschen"]) {
      assert.ok(!PANEL.includes(claim), `the copy claims „${claim}“, which this press does not do`);
    }
  });

  /* Frontend spec §1.3 splits irreversible in two: `Es gibt in der Verwaltung keinen Weg zurück.`
     where the log keeps the pre-image, `Zurückholen lässt sich das nicht.` where the same
     transaction empties it. This one empties it. */
  it("takes the irreversibility sentence for a write that empties the log too", () => {
    assert.match(PANEL, /Zurückholen lässt sich das nicht\./, "the confirmation does not refuse an undo in words");
    assert.ok(!PANEL.includes("keinen Weg zurück"), "the panel promises a readable pre-image its own transaction empties");
  });

  it("arms before it writes, and keeps the object in the armed label", () => {
    // The two-press ORDER is the shared hook's and is pinned once at `shared/hooks/useTwoPressConfirm.test.ts`;
    // what is panel-local is that the write is reached only through `press`, never from the bare handler.
    assert.match(PANEL, /press\(commit\)/, "the panel writes outside the armed press");
    assert.match(PANEL, /<ConfirmReveal>/, "the escalation replaces the copy in place with no announcement");
    assert.match(PANEL, /className=\{confirmButton\(isConfirming\)\}/, "the armed press is not graded as destructive");
    assert.match(
      PANEL,
      /"Löscht\.\.\." : isConfirming \? "Ja, Kontaktperson endgültig löschen" : "Kontaktperson löschen"/,
      "the label lost a state",
    );
    assert.ok(!PANEL.includes('"Ja, endgültig löschen"'), "the armed label drops the object, and reads as the team going");
  });

  /* One `h1` per page and the shell owns it. The heading LEVEL is `PanelHeading`'s now and pinned there;
     what this panel owes is using it, and its readout's `h3`. */
  it("raises no heading the shell already owns", () => {
    assert.ok(!PANEL.includes("<h1"), "the panel raises a second h1");
    assert.ok(!PAGE.includes("<h1"), "the page raises an h1 the shell already owns");
    assert.ok(PANEL.includes("<PanelHeading className={panel.heading()}"), "the panel spells its own heading again");
  });
});

describe("the address the press acts on", () => {
  /* A ratified decision: a typed field is judged when it is LEFT. A message between two keystrokes
     describes a value nobody finished entering. */
  it("judges the address on blur and never between keystrokes", () => {
    assert.match(
      PANEL,
      /onBlur=\{\(\) => validatePaths\("erasure", \{ email \}, \["email"\]\)\}/,
      "the field is no longer judged when it is left",
    );
    assert.ok(!ADDRESS_CHANGE.includes("validatePaths"), "the change handler judges the address between keystrokes");
    assert.match(
      PANEL,
      /useDraftFieldErrors\(\{ schemas: \{ erasure: FLKontaktErasurePayloadSchema \}, \}\)/,
      "the panel judges off some other hook",
    );
  });

  /* Both halves or neither: a `<Form>` with no `validationErrors` shows a server refusal nowhere,
     and its `formRef` is what moves focus onto a refused box. An `action` would reset every
     controlled field (frontend spec I32). */
  it("renders the one field-error map through a form the hook can reach", () => {
    assert.match(PANEL, /<Form\b/, "the panel renders no form");
    assert.match(PANEL, /ref=\{formRef\}/, "the hook cannot reach the form");
    assert.match(PANEL, /validationErrors=\{fieldErrors\}/, "the field errors reach no form");
    assert.match(PANEL, /onSubmit=\{runOnSubmit\(handleArm\)\}/, "the form no longer submits through runOnSubmit");
    assert.ok(!/\saction=\{/.test(PANEL), "the form takes an action, which React resets each submit");
  });

  /* The submit ARMS and never commits: Return auto-repeats, so as a submit this control would take
     the repeat as its second press behind one decision. Every other `useTwoPressConfirm` control in
     the app is a `type="button"`. */
  it("keeps the commit off the form's submit", () => {
    assert.ok(!PANEL.includes('<Button type="submit"'), "the confirm control is a submit, which the Return key repeats into");
    assert.match(
      PANEL,
      /<Button type="button" variant="primary" isDisabled=\{isErasing\} onPress=\{handleErase\}/,
      "the button lost its own press",
    );
    assert.deepEqual(
      statementsOf(HANDLE_ARM),
      ["const handleArm = () => {", "if (!isConfirming) press(commit);", "};"],
      "the arm handler changed shape",
    );
    assert.ok(!HANDLE_ARM.includes("commit()"), "the arm handler calls the write rather than arming it");
  });

  /* Handed to the hook, which runs it before arming AND before writing — that order is pinned at
     `shared/hooks/useTwoPressConfirm.test.ts`. An unjudged address may not reach the wire. */
  it("guards both presses on the address", () => {
    assert.match(PANEL, /useTwoPressConfirm\(judgeAddress\)/, "the panel arms on an address nothing judged");
    // The whole body, exactly: the verdict is whether the block RAN the write, so a hardcoded `true` or an
    // extra disjunct widening what counts as judged both leave this list changed rather than still matching.
    assert.deepEqual(statementsOf(JUDGE_ADDRESS), [
      "const judgeAddress = (): boolean => {",
      "let mayWrite = false;",
      "guardSubmit({ erasure: { email } }, () => {",
      "mayWrite = true;",
      "});",
      "return mayWrite;",
      "};",
    ]);
  });

  /* The reveal names one address. Editing the box after arming would leave a press standing over a
     value nobody read there, so the escalation drops with the change. */
  it("disarms when the address changes", () => {
    assert.match(ADDRESS_CHANGE, /if \(isConfirming\) cancel\(\);/, "an edit leaves the panel armed over the address it replaced");
  });

  /* The value is what the press exists to destroy, so it does not stay on screen afterwards. */
  it("clears the box once the write lands", () => {
    assert.match(
      PANEL,
      /appToast\.success\("Kontaktperson gelöscht"[\s\S]*?setEmail\(""\);[\s\S]*?router\.refresh\(\);/,
      "the erased address stays in the box",
    );
  });
});

describe("the report the toast carries", () => {
  /* An address naming nobody is an ordinary outcome rather than a failure: it is what the admin
     presses when they are not sure the person was ever recorded. */
  it("reports both counts, each with its own zero and its own singular", () => {
    assert.equal(
      describeKontaktErasureUmfang(erasure({})),
      "Zu dieser E-Mail-Adresse war nichts gespeichert. Im Änderungsprotokoll gab es dazu keinen Eintrag.",
    );
    assert.equal(
      describeKontaktErasureUmfang(erasure({ cleared_saison_teams: 1, cleared_kontakt_slots: 1, redacted_aktionen: 1 })),
      "Ein Kontakteintrag wurde geleert, in einer Saison-Zugehörigkeit und keiner Bewerbung. " +
        "Bei einem Eintrag im Änderungsprotokoll ist kein gesicherter Stand mehr hinterlegt.",
    );
    assert.equal(
      describeKontaktErasureUmfang(
        erasure({ cleared_saison_teams: 2, cleared_bewerbungen: 3, cleared_kontakt_slots: 5, redacted_aktionen: 12 }),
      ),
      "5 Kontakteinträge wurden geleert, in 2 Saison-Zugehörigkeiten und 3 Bewerbungen. " +
        "Bei 12 Einträgen im Änderungsprotokoll ist kein gesicherter Stand mehr hinterlegt.",
    );
  });

  /* GELEERT, never deleted: no log row is dropped, only the values one held. The word is the whole
     difference between what happened and what the sentence would otherwise claim. */
  it("claims of the log only what is true of a row that lost nothing", () => {
    const report = describeKontaktErasureUmfang(erasure({ cleared_saison_teams: 1, cleared_kontakt_slots: 1, redacted_aktionen: 4 }));

    // `build_redaction_filter` is not narrowed to rows holding an image, so a row recording an insert
    // is stamped and counted while losing nothing. „geleert“ and „gelöscht“ are both false of it.
    assert.match(report, /Bei 4 Einträgen im Änderungsprotokoll ist kein gesicherter Stand mehr hinterlegt\./);
    assert.doesNotMatch(report, /Einträge im Änderungsprotokoll wurden geleert/, "the report empties a row that held nothing");
    assert.doesNotMatch(report, /Einträge im Änderungsprotokoll (wurden )?gelöscht/, "the report deletes a log row, and none is dropped");
    // The slots really are nulled, so the contact half keeps the verb the log half may not have.
    assert.match(
      describeKontaktErasureUmfang(erasure({ cleared_kontakt_slots: 2, cleared_saison_teams: 1 })),
      /Kontakteinträge wurden geleert/,
    );
  });

  /* A person swapped out of every seat clears no slot while the log still names them. As two
     sentences the pair contradicts itself, so the whole string is what this pins. */
  it("reports a cleared log beside no cleared slot as one coherent sentence", () => {
    assert.equal(
      describeKontaktErasureUmfang(erasure({ redacted_aktionen: 1 })),
      "Zu dieser E-Mail-Adresse war kein aktueller Kontakteintrag gespeichert, nur noch ein Eintrag im Änderungsprotokoll, " +
        "und dort ist jetzt kein gesicherter Stand mehr hinterlegt.",
    );
    assert.equal(
      describeKontaktErasureUmfang(erasure({ redacted_aktionen: 4 })),
      "Zu dieser E-Mail-Adresse war kein aktueller Kontakteintrag gespeichert, nur noch 4 Einträge im Änderungsprotokoll, " +
        "und dort ist jetzt kein gesicherter Stand mehr hinterlegt.",
    );
    // The claim the old wording made, and the one the pair cannot both hold.
    assert.doesNotMatch(
      describeKontaktErasureUmfang(erasure({ redacted_aktionen: 1 })),
      /war nichts gespeichert/,
      "the report denies a person the change log still named",
    );
    // „geleert“ and „gelöscht“ stay false of a log row here too: a row recording an insert is stamped
    // while losing nothing.
    assert.doesNotMatch(describeKontaktErasureUmfang(erasure({ redacted_aktionen: 4 })), /Änderungsprotokoll (wurden |wurde )?gel(eert|öscht)/);
  });

  /* A toast description stands on its own, with no figures beside it to carry the grammar. */
  it("writes whole sentences rather than a telegraphic list", () => {
    const reports = [
      describeKontaktErasureUmfang(erasure({})),
      describeKontaktErasureUmfang(erasure({ cleared_saison_teams: 1, cleared_kontakt_slots: 1, redacted_aktionen: 1 })),
      describeKontaktErasureUmfang(erasure({ cleared_bewerbungen: 3, cleared_kontakt_slots: 3, redacted_aktionen: 9 })),
    ];

    for (const report of reports) {
      assert.match(report, /^[A-ZÄÖÜ0-9]/, "the report opens lower-case");
      for (const satz of report.split(". ")) assert.match(satz, /\b(wurde|wurden|war|gab|ist)\b/, `„${satz}“ carries no verb`);
      // The endpoint withholds the person, and a report is the one place a copy could creep back in.
      assert.doesNotMatch(report, /@/, "the report names an address");
    }
  });
});

describe("where the control stands", () => {
  /* Below the list and not on a row: the operation is keyed on the ADDRESS across every season and
     both collections, and the applications it also reaches appear on no row of this page. */
  it("stands inside the panel of the person it erases, never on the list", () => {
    /* Moved off the list and onto the person. The reach is what makes the placement matter: keyed on
       an ADDRESS, it clears every season and both collections, so a reader has to see whose data it
       is while reading what it takes. */
    assert.ok(!PAGE.includes("AdminKontaktErasureForm"), "the erasure is back on the list, detached from the person");
    assert.match(SECTION, /<FormKontaktErasure email=\{person\.email\}/, "no seat offers the erasure of the person it holds");
  });

  /* The claim points two seats at one record. Offered on both, the same person would read as two, and
     the second press would erase somebody already gone. */
  it("offers it on the seat that holds the person, never on the mirrored copy", () => {
    assert.match(
      SECTION,
      /person !== null && !isMirrored && person\.email !== "" && \( <FormKontaktErasure/,
      "the mirrored seat offers its own erasure",
    );
  });

  /* The page's chrome may never wait on the list, and the fetch below the boundary may never run in
     the image build. Both halves are the page's, and the panel is outside them. */
  it("leaves the page's shape intact", () => {
    assert.match(PAGE, /export default function AdminKontaktePage/, "the page's default export became async");
    // The FIRST statement, not merely a present one: the image builder reaches no backend, so a fetch
    // ordered above this call runs at build time. `[\s\S]*?` would have admitted one in between.
    assert.equal(
      // Index 1: index 0 is the function's own signature, which the cut opens on.
      statementsOf(sliceBetween(PAGE_SOURCE, "async function KontakteTable", null))[1],
      "await connection();",
      "the data component no longer opens with await connection()",
    );
  });
});
