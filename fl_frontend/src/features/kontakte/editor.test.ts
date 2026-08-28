import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { declaredCodes, sliceBetween } from "../../core/refusalRegister.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const SRC = path.resolve(REPO_ROOT, "fl_frontend", "src");

const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");
const MUTATIONS = readFileSync(path.resolve(import.meta.dirname, "mutations.ts"), "utf8");
const SCHEMAS = readFileSync(path.resolve(import.meta.dirname, "schemas.ts"), "utf8");

const EDITOR_DIR = path.resolve(import.meta.dirname, "components", "forms", "AdminKontakteEditForm");
const FORM_SOURCE = readFileSync(path.resolve(EDITOR_DIR, "AdminKontakteEditForm.tsx"), "utf8");
const SECTION_SOURCE = readFileSync(path.resolve(EDITOR_DIR, "FormKontakteSection.tsx"), "utf8");
/** Whitespace-collapsed: the section's copy is JSX text, so the formatter picks its line breaks. */
const SECTION = SECTION_SOURCE.replace(/\s+/g, " ");
const BANNERS = readFileSync(path.resolve(EDITOR_DIR, "banners.ts"), "utf8");

const PAGE_SOURCE = readFileSync(path.resolve(SRC, "app", "admin", "kontakte", "[team_id]", "page.tsx"), "utf8");
const PAGE = PAGE_SOURCE.replace(/\s+/g, " ");
const VIEW = readFileSync(path.resolve(import.meta.dirname, "components", "views", "AdminKontakteEditView.tsx"), "utf8");

/** The club editor, which lost the block and shows the way here instead. */
const TEAM_FORM_DIR = path.resolve(SRC, "features", "teams", "components", "forms", "AdminTeamEditForm");
const TEAM_FORM = readFileSync(path.resolve(TEAM_FORM_DIR, "AdminTeamEditForm.tsx"), "utf8");
const TEAM_LINK_SOURCE = readFileSync(path.resolve(TEAM_FORM_DIR, "FormKontakteLinkSection.tsx"), "utf8");
const TEAM_LINK = TEAM_LINK_SOURCE.replace(/\s+/g, " ");
/** The list this editor is reached from. */
const LIST_TABLE = readFileSync(path.resolve(SRC, "features", "teams", "components", "collections", "AdminKontakteTable.tsx"), "utf8").replace(
  /\s+/g,
  " ",
);

/** The undo the editor dispatches to, read as source for the same reason the editor is. */
const UNDO_ROUTE = readFileSync(path.resolve(SRC, "app", "api", "admin", "kontakte", "undo", "route.ts"), "utf8");

const KONTAKTE_OPERATION = "PATCH /teams/{team_id}/saisons/{saison_id}/kontakte";

/* Each declaration is cut at the one named after it: a boundary that stopped matching then fails the
   case pinning the cut rather than every case reading the slice. */
const PATCH_ACTION = sliceBetween(ACTIONS, "export async function patchSaisonTeamKontakteAction", null);
const PATCH_MUTATION = sliceBetween(MUTATIONS, "export async function patchSaisonTeamKontakte", null);
const PAYLOAD_SCHEMA = sliceBetween(
  SCHEMAS,
  "export const FLPatchSaisonTeamKontaktePayloadSchema",
  "export type FLPatchSaisonTeamKontaktePayload",
);
const RESPONSE_SCHEMA = sliceBetween(
  SCHEMAS,
  "export const FLPatchSaisonTeamKontakteResponseSchema",
  "export type FLPatchSaisonTeamKontakteResponse",
);
const SUBMIT = sliceBetween(FORM_SOURCE, "const handleFormSubmit", "return (");
const REQUEST_LEAVE = sliceBetween(FORM_SOURCE, "const requestLeave", "const resetDraftToStored");
const OFFER_UNDO = sliceBetween(FORM_SOURCE, "const offerUndo", "return (");
/* Cut at the signature's closing brace rather than at the declaration: the parameter list spans
   several lines, and each would otherwise read as a statement of the body. */
const PAGE_CONTENT = sliceBetween(PAGE_SOURCE, "}) {", null);

/**
 * One function body's statements, comments and blank lines dropped. What the text tests below can
 * assert is the SHAPE of a handler; that it behaves is not reachable from here.
 */
function statementsOf(slice: string): string[] {
  return slice
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("/*") && !line.startsWith("*"));
}

describe("the contacts write against the backend's refusal register", () => {
  /* First, because a boundary string that stopped matching leaves the slices empty and every
     assertion over them would then fail for something that is not the defect. */
  it("cuts each declaration out of its file before reading it", () => {
    assert.ok(PATCH_ACTION.includes("patchSaisonTeamKontakte(validated.data)"), "the write's call is outside its slice");
    assert.ok(!PATCH_ACTION.includes("eraseKontaktperson("), "the write's slice reaches back over the erasure");
    assert.ok(PATCH_MUTATION.includes("/kontakte`"), "the mutation's slice does not reach the endpoint it addresses");
    assert.ok(!PATCH_MUTATION.includes("/kontakte/erasure"), "the mutation's slice reaches back over the erasure");
    assert.ok(PAYLOAD_SCHEMA.includes("team_id"), "the payload mirror's slice does not reach its fields");
    assert.ok(RESPONSE_SCHEMA.includes("kontakte"), "the response mirror's slice does not reach its fields");
    assert.ok(SUBMIT.includes("patchSaisonTeamKontakteAction("), "the submit's slice does not reach its dispatch");
    assert.ok(REQUEST_LEAVE.includes("leavePage()"), "the leave request's slice does not reach the navigation it guards");
    assert.ok(!REQUEST_LEAVE.includes("resetDraftToStored"), "the leave request's slice reaches forward over the reset");
    assert.ok(OFFER_UNDO.includes("appToast.success("), "the undo offer's slice does not reach the toast it raises");
    assert.notEqual(PAGE_CONTENT, "", "the page's data component is no longer where the cut looks for it");
  });

  /* The endpoint refuses nothing: it replaces a block that is already the admin's to write, and the
     row it hangs off is named by the path. A rule declared against it later fails here, rather than
     reaching the admin unmapped. */
  it("has no refusal to map, and maps none", () => {
    assert.deepEqual(declaredCodes(KONTAKTE_OPERATION), []);
    assert.ok(!PATCH_ACTION.includes("serverErrorCode"), "the write maps a code its endpoint does not answer");
    assert.ok(!PATCH_ACTION.includes("APIBadStatusError"), "the write catches a refusal its endpoint does not raise");
  });

  /* The floor under the case above: an empty list has to mean "this endpoint declares none" rather
     than "the register was read as nothing at all". */
  it("reads a declared refusal where one exists", () => {
    assert.deepEqual(declaredCodes("POST /teams/{team_id}/saisons"), ["REQ-ENTER-001", "REQ-ENTER-002", "REQ-ENTER-003", "REQ-ENTER-005"]);
  });

  /* The house shape, in order: the session first, because `runAdminMutation` seeds the scope the
     actor header is read from, then the parse, then the write, then the acknowledgement. */
  it("takes the house shape for an admin write", () => {
    assert.match(PATCH_ACTION, /runAdminMutation\("patchSaisonTeamKontakteAction"/, "the write runs outside runAdminMutation");
    const order = ["getAdminSession()", "FLPatchSaisonTeamKontaktePayloadSchema.safeParse", "patchSaisonTeamKontakte(", "acknowledged"].map(
      (token) => PATCH_ACTION.indexOf(token),
    );
    assert.ok(
      order.every((at, index) => at !== -1 && (index === 0 || at > (order[index - 1] ?? -1))),
      `the write's steps are out of order or missing: ${order.join(", ")}`,
    );
  });

  /* Both ids in the PATH: a backend payload model that saw one refuses the whole body. */
  it("addresses the junction row by its natural key and sends the block alone", () => {
    assert.match(PATCH_MUTATION, /method: "PATCH"/, "the block is written by something other than a PATCH");
    assert.match(PATCH_MUTATION, /`\/teams\/\$\{team_id\}\/saisons\/\$\{saison_id\}\/kontakte`/, "the endpoint moved");
    assert.match(PATCH_MUTATION, /body: JSON\.stringify\(body\)/, "the block no longer travels in the body");
    // Destructured out of the body, so neither id can be sent twice.
    assert.deepEqual(statementsOf(PATCH_MUTATION).slice(1, 5), [
      "team_id,",
      "saison_id,",
      "...body",
      "}: FLPatchSaisonTeamKontaktePayload): Promise<FLPatchSaisonTeamKontakteResponse> {",
    ]);
  });

  /* The response is the block as stored and no other field of the row: the group, the kit colour and
     the Austritt are the club editor's, and echoing them here would give this page a second subject. */
  it("mirrors a response carrying the block and nothing beside it", () => {
    assert.deepEqual(
      [...RESPONSE_SCHEMA.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]),
      ["saison_id", "team_id", "kontakte"],
    );
  });

  /* The payload mirror is composed from the club editor's, never restated: the two write the same
     block, and a second spelling would drift with nothing able to see it. */
  it("reuses the block's own mirror rather than restating it", () => {
    assert.match(PAYLOAD_SCHEMA, /kontakte: FLSaisonTeamKontaktePayloadSchema\.nullable\(\)/, "the payload spells the block a second time");
    assert.match(SCHEMAS, /from "@\/features\/teams\/schemas"/, "the block's mirror is no longer imported");
  });
});

describe("what the contacts write moves", () => {
  /* No cached read holds a contact person: the memberships read is admin-tier and memoised per
     render pass, and no public team read carries `kontakte` at all. */
  it("invalidates nothing, and says why", () => {
    assert.ok(!PATCH_ACTION.includes("updateTag("), "the write clears a cached read its endpoint does not move");
    assert.match(PATCH_ACTION, /Nothing to invalidate/, "the absent invalidation is left unexplained");
  });

  /* The whole block or nothing. A partial send would leave the row holding one half of an agreement,
     which is why the field is required with no default on either side. */
  it("sends the block whole, nullable, and with no default", () => {
    assert.ok(!PAYLOAD_SCHEMA.includes(".optional()"), "the block may be omitted, which leaves the stored one standing unannounced");
    assert.ok(!PAYLOAD_SCHEMA.includes(".default("), "the block carries a default, so a form that forgot it would write one");
  });
});

describe("the editor's shape", () => {
  /* The shared editor surface, in full: a slice contributes its descriptors and its banners and
     takes everything structural from `shared/components/ui`. */
  it("is built from the shared editor modules and declares none of its own", () => {
    for (const shared of [
      "EditFormLayout",
      "FormActionBar",
      "DraftRail",
      "DraftStatusProvider",
      "ConfirmDiscardModal",
      "ConfirmSaveModal",
      "useDraftFieldErrors",
      "runOnSubmit",
    ]) {
      assert.ok(FORM_SOURCE.includes(`{ ${shared} }`), `the editor no longer takes ${shared} from the shared surface`);
    }
    assert.match(FORM_SOURCE, /deriveKontakteDraftStatus/, "the editor derives its draft status somewhere else");
  });

  /* One `h1` per page and the shell owns it. A panel heading is an `h2`, a seat's is an `h3`. */
  it("raises no heading the shell already owns", () => {
    for (const [name, source] of [
      ["the page", PAGE],
      ["the view", VIEW],
      ["the section", SECTION],
      ["the form", FORM_SOURCE],
    ] as const) {
      assert.ok(!source.includes("<h1"), `${name} raises an h1 the shell already owns`);
    }
    assert.match(SECTION, /<h2 className=\{panel\.heading\(\)\}>/, "the panel's heading is no longer an h2");
  });

  /* The page's chrome may never wait on the row, and the fetch below the boundary may never run in
     the image build. `params` is awaited INSIDE the boundary for the same reason. */
  it("leaves the page's shape intact", () => {
    assert.match(PAGE, /export default function AdminKontakteEditPage/, "the page's default export became async");
    // The FIRST statement, not merely a present one: the image builder reaches no backend, so a fetch
    // ordered above this call runs at build time.
    assert.equal(
      // Index 1: index 0 is the signature's closing line, which the cut opens on.
      statementsOf(PAGE_CONTENT)[1],
      "await connection();",
      "the data component no longer opens with await connection()",
    );
    assert.match(PAGE, /await resolveTeamId\(params\)/, "the route's own id is resolved outside the boundary");
    assert.match(PAGE, /resolveSaisonId\(searchParams, "admin"\)/, "the season is resolved at the wrong tier, or not at all");
  });

  /* Re-seeding is a `key`, not a prop: every field is `useState` initialised from the row, and an
     initialiser runs once per mounted instance. */
  it("keys the view by the state the draft mirrors", () => {
    assert.match(PAGE, /key=\{JSON\.stringify\(\{ team, saison \}\)\}/, "the editor's subtree is keyed by something else");
  });

  /* A ratified decision: a typed field is judged when it is LEFT. A message between two keystrokes
     describes a value nobody finished entering. */
  it("judges a typed field on blur and a picked one on the press", () => {
    assert.match(SECTION, /onBlur=\{\(\) => onFieldLeft\(\[`kontakte\.\$\{rolle\}\.vorname`\]\)\}/, "a typed seat field is judged elsewhere");
    assert.ok(!/onChange=\{\(next\) => \{[^}]*onFieldLeft/.test(SECTION_SOURCE), "a change handler judges a seat's field between keystrokes");
    assert.match(
      SECTION,
      /onValidateSelection\(mirroredJudgedPaths\(\[`kontakte\.\$\{rolle\}\.einwilligung\.erteilt_von`\], isMirroring\)/,
      "the picked agreement is judged elsewhere",
    );
  });

  /* Both switches hand their re-judging decision to a pure function, and the blur hands its path set
     to one: an inline condition at any of the three is a rule stated twice, and `utils.test.ts` is
     where each of them is proven in both directions. */
  it("takes every re-judging decision from the shared helpers", () => {
    assert.match(
      SECTION,
      /const \{ next, revalidate \} = applySeatPresence\(value, rolle, present\);/,
      "a seat's switch judges the mirror itself",
    );
    assert.match(
      SECTION,
      /const \{ next, revalidate \} = applySharedFlag\(value, shared\);/,
      "the shared-seat switch judges the mirror itself",
    );
    assert.match(SECTION, /onFieldLeft\(mirroredJudgedPaths\(paths, isMirroring\)\)/, "a left field is judged without the mirror's copy of it");
    assert.match(SECTION, /onFieldLeft=\{judgeFieldsLeft\}/, "the seats are handed the raw handler, so the mirror's copy is never re-judged");
  });

  /* An empty seat is a saveable state rather than a half-finished one, and the record keeps no field
     saying why it is empty — so nothing here may say why either. */
  it("renders an empty seat as its switch alone, and never explains one", () => {
    for (const claim of ["gelöscht", "entfernt worden", "nicht mehr", "unbekannt", "keine Angabe"]) {
      assert.ok(!SECTION.includes(claim), `the section says „${claim}“ about a seat, which the row records no field for`);
    }
    // A dash doing a word's job is what `docs/frontend/spec.md` §1.12 bans; the list beside this
    // editor spells the empty seat out instead.
    assert.match(LIST_TABLE, /kontakt\.person === null \? "Niemand hinterlegt"/, "an empty seat stopped reading as a sentence");
  });

  /* Both halves or neither: a `<Form>` with no `validationErrors` shows a server refusal nowhere,
     and its `formRef` is what moves focus onto a refused box. An `action` would reset every
     controlled field (frontend spec I32). */
  it("renders the one field-error map through a form the hook can reach", () => {
    assert.match(FORM_SOURCE, /<Form\s+ref=\{formRef\}\s+validationErrors=\{fieldErrors\}/, "the field errors reach no form");
    assert.match(FORM_SOURCE, /onSubmit=\{runOnSubmit\(requestSave\)\}/, "the form no longer submits through runOnSubmit");
    assert.ok(!/\saction=\{/.test(FORM_SOURCE), "the form takes an action, which React resets each submit");
  });

  /* Both gates of the reused-tree defect, and neither is sufficient alone: the key above re-seeds a
     reopened editor, and this reset is what makes a tree the router kept alive honest. */
  it("resets the draft on both exits", () => {
    assert.match(SUBMIT, /resetDraftToStored\(\);\s*\n\s*leavePage\(\);/, "a save leaves typed values standing in the tree");
    assert.match(FORM_SOURCE, /const discardAndLeave = \(\) => \{\s*\n\s*resetDraftToStored\(\);/, "a discard leaves typed values standing");
  });

  /* Unsaved work may not leave unasked. The dialog lives in a rendered tree and this repo has no
     DOM test infrastructure, so what is reachable here is the handler's SHAPE: the whole body, so a
     guard weakened into a no-op still fails. */
  it("takes the shape that guards the way out on unsaved changes", () => {
    assert.deepEqual(statementsOf(REQUEST_LEAVE), [
      "const requestLeave = () => {",
      "if (isDirty) {",
      "setHasLeftViaDiscard(false);",
      "setIsConfirmingDiscard(true);",
      "return;",
      "}",
      "leavePage();",
      "};",
    ]);
    assert.match(FORM_SOURCE, /onLeave=\{requestLeave\}/, "the header's way out skips the discard guard");
    assert.match(FORM_SOURCE, /onCancel=\{requestLeave\}/, "the action bar's way out skips the discard guard");
  });

  /* A page-owned editor, so §1.3 allows its undo a route handler. The write replaces the block whole
     on a row the path names, so the pre-save block restores through the same PATCH. */
  it("offers an undo, and dispatches it to its own route handler", () => {
    assert.match(FORM_SOURCE, /children: "Rückgängig"/, "the editor no longer offers an undo");
    // A `fetch` and not a server action: the press lands after this component has unmounted, which is
    // the whole of why the eight undos are route handlers at all.
    assert.match(FORM_SOURCE, /await fetch\("\/api\/admin\/kontakte\/undo", \{/, "the undo dispatches somewhere other than its own route");
    assert.ok(!FORM_SOURCE.includes('"use server"'), "the undo went back to a server action while E592 still reproduces");
  });

  /* The eighth handler, on the spine the others share, replaying the save's own mutation rather than
     a second write path. It clears nothing: no cached read holds a contact person. */
  it("stands the undo on the shared spine and clears no cached read", () => {
    assert.match(UNDO_ROUTE, /handleUndoRequest\(request, \{/, "the route no longer runs on the shared undo spine");
    assert.match(UNDO_ROUTE, /schema: FLPatchSaisonTeamKontaktePayloadSchema,/, "the route parses something other than the save's payload");
    assert.match(UNDO_ROUTE, /await patchSaisonTeamKontakte\(payload\)/, "the restore calls something other than the save's own mutation");
    assert.ok(!UNDO_ROUTE.includes("revalidateTag"), "the undo clears a cached read its endpoint does not move");
    assert.match(UNDO_ROUTE, /invalidate: \(\) => undefined,/, "the undo grew an invalidation");
    assert.match(UNDO_ROUTE, /Nothing to clear/, "the absent invalidation is left unexplained");
  });

  /* The STORED block and both ids, which is the whole payload the endpoint takes — so the restore is
     the save run backwards rather than a second write shape nothing else exercises. */
  it("sends the pre-save block, captured before the write that replaces it", () => {
    assert.match(
      SUBMIT,
      /const undoPayload: FLPatchSaisonTeamKontaktePayload = \{ team_id: teamId, saison_id: saison\.saisonId, kontakte: storedKontakte \};/,
      "the undo replays something other than the pre-save block",
    );
    const capturedAt = SUBMIT.indexOf("const undoPayload");
    const writtenAt = SUBMIT.indexOf("patchSaisonTeamKontakteAction(");
    assert.ok(capturedAt !== -1 && writtenAt !== -1 && capturedAt < writtenAt, "the undo payload is captured after the write that moves it");
    // Unconditional: a ratified decision keeps the offer on the save the confirmation dialog gated too.
    assert.match(SUBMIT, /offerUndo\(undoPayload, res\.message\);/, "the undo offer is scoped to some saves rather than every one");
  });
});

describe("what the undo says when it cannot run", () => {
  /* Backend I36 (`docs/backend/spec.md`) admits a malformed address on READ, and such a block is no
     legal write. The spine can only answer that body with a reload, so the caller — which alone
     holds the payload and the reason — diagnoses first. */
  // The diagnosis itself: `fl_frontend/src/features/kontakte/utils.test.ts :: describeUnrestorableKontakte`.
  it("diagnoses an unrestorable block itself rather than dispatching it", () => {
    assert.match(OFFER_UNDO, /const unrestorable = describeUnrestorableKontakte\(payload\);/, "the offer no longer judges its own payload");
    const judgedAt = OFFER_UNDO.indexOf("describeUnrestorableKontakte");
    const dispatchedAt = OFFER_UNDO.indexOf("postKontakteUndo(payload)");
    assert.ok(judgedAt !== -1 && dispatchedAt !== -1 && judgedAt < dispatchedAt, "the payload is judged after the dispatch it would spare");
    assert.match(OFFER_UNDO, /if \(unrestorable !== null\) \{[\s\S]*?return;/, "an unrestorable block is dispatched anyway");
  });

  /* The dispatch never reached a judgement: the route answers 200 with the outcome in the body for
     every reportable case, so a throw here is the transport. Sending the admin to inspect the
     contact data names something nothing on this path read. */
  it("blames only the transport where the dispatch never landed", () => {
    assert.match(OFFER_UNDO, /description: "Die Änderung steht weiterhin\. Prüfe die Verbindung\."/, "the transport failure moved");
    assert.ok(!OFFER_UNDO.includes("Prüfe die Verbindung und die Kontaktdaten"), "a failed dispatch blames data nothing judged");
  });
});

describe("what the banners say", () => {
  /* `resolveBlockingBanners` takes the non-info banners raised by the CHANGE, so these two are what
     open the save dialog — and a standing situation, however grave, asks nothing. */
  it("grades the two removals as changes and the two situations as state", () => {
    const gradeOf = (id: string) => sliceBetween(BANNERS, `id: "${id}"`, "inline:");

    assert.match(gradeOf("kontakte.block-removed"), /severity: "warning",\s*\n\s*raisedBy: "change"/);
    assert.match(gradeOf("kontakte.seats-emptied"), /severity: "warning",\s*\n\s*raisedBy: "change"/);
    assert.match(gradeOf("kontakte.not-in-saison"), /severity: "info",\s*\n\s*raisedBy: "state"/);
    assert.match(gradeOf("kontakte.saison-past"), /severity: "info",\s*\n\s*raisedBy: "state"/);
  });

  /* The block's own removal takes every seat with it, so the per-seat sentence beneath it would name
     seats inside a block that is going whole. */
  it("drops the per-seat sentence where the whole block goes", () => {
    assert.match(BANNERS, /supersedes: \["kontakte.seats-emptied"\]/, "both removals are stated at once");
  });

  /* No count in a sentence that would have to agree with it: the seats are read out in the body
     instead, which is what keeps the wording right for one seat and for three. */
  it("names the emptied seats in a readout rather than counting them", () => {
    assert.match(BANNERS, /body: `Betroffen: \$\{emptiedSeatLabels\.join\(", "\)\}\.`/, "the seats are no longer read out");
    assert.ok(!BANNERS.includes("emptiedSeatLabels.length}"), "the banner interpolates a count into a sentence that has to agree with it");
  });
});

describe("the way in and out of the editor", () => {
  /* The club editor holds none of the block any more, and the link in its place carries the season:
     the seats are season-scoped, so a link without it would open another season's three people. */
  it("leaves the club editor with a link and none of the block", () => {
    assert.ok(!TEAM_FORM.includes("FormKontakteSection"), "the club editor still renders the contacts block");
    assert.ok(!TEAM_FORM.includes("setKontakte"), "the club editor still holds the block in state");
    assert.match(TEAM_FORM, /href=\{`\/admin\/kontakte\/\$\{team\.id\}\?saison_id=\$\{encodeURIComponent\(saison\.saisonId\)\}`\}/);
    // Off the junction payload entirely: `FLPatchSaisonTeamPayloadSchema` declares no `kontakte`, the
    // backend refuses one sent there, and the seats travel through their own endpoint instead.
    assert.ok(!/kontakte: /.test(TEAM_FORM), "the club editor's junction payload carries the block a second endpoint owns");
  });

  /* Seats HELD, never the three the block always carries: an erasure leaves a block whose seats are
     empty, and a count off the block's presence would call that three. */
  it("counts the seats the link names off what is in them", () => {
    assert.match(TEAM_LINK, /KONTAKT_ROLLEN\.filter\(\(\{ value \}\) => kontakte\?\.\[value\] != null\)\.length/, "the count moved");
    // Each number spelled: `0` and `1` need their own German, and the link's text is its accessible name.
    assert.match(TEAM_LINK, /Kontakte für Saison \$\{saisonId\} hinterlegen/, "the empty case reads as a count of none");
    assert.match(TEAM_LINK, /1 Kontakteintrag für Saison \$\{saisonId\} bearbeiten/, "the singular reads as a plural");
    assert.match(TEAM_LINK, /\$\{String\(belegt\)\} Kontakteinträge für Saison \$\{saisonId\} bearbeiten/, "the plural moved");
    // Never „Personen“: `trainer_ist_ansprechperson` seats one person twice, so the entries are what
    // can honestly be counted.
    assert.ok(!TEAM_LINK.includes("Personen für Saison"), "the link counts people, and a double-seated person makes that wrong");
  });

  /* The editor's own way back out, which the list's link and the club editor's each carry too. What
     the builder returns is `fl_frontend/src/features/kontakte/utils.test.ts :: teamPageHref`. */
  it("sends the panel's way out through the builder that carries the season", () => {
    assert.match(
      FORM_SOURCE,
      /teamHref=\{teamPageHref\(teamId, saison\.saisonId\)\}/,
      "the way out is spelled a second time, or lost the season",
    );
  });

  /* One noun for one concept: `Saison-Zugehörigkeit` is what the admin surface calls a junction row,
     and a second word for it inside one slice reads as a second thing. */
  it("calls the junction row by the admin surface's own noun", () => {
    assert.match(BANNERS, /Kontakte werden bei der Saison-Zugehörigkeit hinterlegt/, "the banner renamed the row the seats hang off");
    for (const [name, source] of [
      ["the banners", BANNERS],
      ["the section", SECTION],
      ["the form", FORM_SOURCE],
    ] as const) {
      assert.ok(!source.includes("Saisonteilnahme"), `${name} carries a second noun for the junction row`);
    }
  });

  /* A row of the list is one seat, and all three are edited together, so the row's control opens this
     editor rather than the club's. */
  it("points every row of the list at this editor, with the season riding along", () => {
    assert.match(LIST_TABLE, /href=\{`\/admin\/kontakte\/\$\{kontakt\.teamId\}\$\{saisonParam\}`\}/, "a row still opens the club editor");
    assert.ok(!LIST_TABLE.includes("/admin/teams/${kontakt.teamId}"), "a row still links to the club editor for its contacts");
  });
});
