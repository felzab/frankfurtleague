import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { TRAINER_ZUGLEICH_FRAGE, TRAINER_ZUGLEICH_OPTIONS } from "@/features/teams/constants";

import { declaredCodes, sliceBetween } from "../../core/refusalRegister.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const SRC = path.resolve(REPO_ROOT, "fl_frontend", "src");

const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");
const MUTATIONS = readFileSync(path.resolve(import.meta.dirname, "mutations.ts"), "utf8");
const SCHEMAS = readFileSync(path.resolve(import.meta.dirname, "schemas.ts"), "utf8");

const EDITOR_DIR = path.resolve(import.meta.dirname, "components", "forms", "AdminKontakteEditForm");
const FORM_SOURCE = readFileSync(path.resolve(EDITOR_DIR, "AdminKontakteEditForm.tsx"), "utf8");
const SECTION_SOURCE = readFileSync(path.resolve(EDITOR_DIR, "FormKontakteSection.tsx"), "utf8");
const LOESCHEN = readFileSync(path.resolve(EDITOR_DIR, "FormKontakteLoeschenSection.tsx"), "utf8");
const ERASURE = readFileSync(path.resolve(EDITOR_DIR, "FormKontaktErasure.tsx"), "utf8");
const ACTIONS_SRC = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");
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
/** The shared dispatch the editor rides, whose own copy is `undoDispatch.test.ts`'s to hold. */
const DISPATCH = readFileSync(path.resolve(SRC, "shared", "utils", "undoDispatch.ts"), "utf8");

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
const OFFER_UNDO = sliceBetween(FORM_SOURCE, "offerUndo({", "});");
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
    assert.ok(OFFER_UNDO.includes("body: undoPayload,"), "the undo offer's slice does not reach the payload it hands on");
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

  /* One `h1` per page and the shell owns it. The heading LEVEL is `PanelHeading`'s now and pinned there;
     what a seat owes is using it. */
  it("raises no heading the shell already owns", () => {
    for (const [name, source] of [
      ["the page", PAGE],
      ["the view", VIEW],
      ["the section", SECTION],
      ["the form", FORM_SOURCE],
    ] as const) {
      assert.ok(!source.includes("<h1"), `${name} raises an h1 the shell already owns`);
    }
    assert.ok(SECTION.includes("<PanelHeading className={panel.heading()}"), "a seat spells its own heading again");
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
      /onValidateSelection\(mirroredJudgedPaths\(\[`kontakte\.\$\{rolle\}\.einwilligung\.erteilt_von`\], mirroredSeat\)/,
      "the picked agreement is judged elsewhere",
    );
  });

  /* The claim is honoured at the ONE compose site. Written into the draft it overwrites whichever of
     two real people it does not name, on the first keystroke and with no undo — a stored row can hold
     the claim over two DIFFERENT people. */
  it("honours the claim when the payload is composed, and never in the draft", () => {
    assert.match(
      FORM_SOURCE,
      /kontakte: kontakte === null \? null : mirrorKontakte\(kontakte\)/,
      "the payload no longer composes the claim, so the editor saves whatever the draft happens to hold",
    );
    assert.doesNotMatch(SECTION, /onChange\(\s*mirror/, "the section writes the mirror into the draft");
    assert.ok(!SECTION.includes("mirrorTrainerSeat"), "the section reaches for the mirror at all");
  });

  /* The helper can only hand back what the section kept. The draft spells an empty seat `null`, so
     nothing in it holds the person while the switch is off, and a rebuild there is silent data loss
     with no undo behind it. */
  it("keeps what a switched-off seat held, and hands it back on the way on", () => {
    assert.match(SECTION, /abgelegt\.current\[rolle\] = seat;/, "the section drops what a seat held when it is switched off");
    assert.match(SECTION, /applySeatPresence\([^)]*abgelegt\.current\[rolle\][^)]*\)/, "the section never hands the helper the person it kept");
  });

  /* Both controls hand their re-judging decision to a pure function, and the blur hands its path set
     to one: an inline condition at any of the three is a rule stated twice, and `utils.test.ts` is
     where each of them is proven in every direction. */
  it("takes every re-judging decision from the shared helpers", () => {
    // The decision comes FROM the helper, whatever it is passed: the argument list is the switch's
    // business, and pinning it made restoring a switched-off seat read as a regression.
    assert.match(SECTION, /const \{ next, revalidate \} = applySeatPresence\(/, "a seat's switch judges the mirror itself");
    assert.match(SECTION, /const \{ next, revalidate \} = applySharedSeat\(/, "the shared-seat picker judges the mirror itself");
    assert.match(
      SECTION,
      /onFieldLeft\(mirroredJudgedPaths\(paths, mirroredSeat\)\)/,
      "a left field is judged without the mirror's copy of it",
    );
    assert.match(SECTION, /onFieldLeft=\{judgeFieldsLeft\}/, "the seats are handed the raw handler, so the mirror's copy is never re-judged");
  });

  /* An empty seat is a saveable state rather than a half-finished one, and the record keeps no field
     saying why it is empty — so neither surface may say why either. */
  it("renders an empty seat as its switch alone, and never explains one", () => {
    for (const claim of ["gelöscht", "entfernt worden", "nicht mehr", "unbekannt", "keine Angabe"]) {
      assert.ok(!SECTION.includes(claim), `the section says „${claim}“ about a seat, which the row records no field for`);
      assert.ok(!LIST_TABLE.includes(claim), `the list says „${claim}“ about a seat, which the row records no field for`);
    }

    /* The arm that RENDERS it, not merely a null-check somewhere in the file: `LIST_TABLE` collapses
       whitespace, so a bare `person === null ?` also matches the copy handler's own ternary. */
    const leerArm = /person === null \? \((.*?)\) : \(/.exec(LIST_TABLE)?.[1] ?? "";
    assert.notEqual(leerArm, "", "the list no longer gives a seat holding nobody its own arm");

    // Resolved through the file's own constants, so naming the sentence is as good as inlining it.
    const genannt = /\{(\w+)\}/.exec(leerArm)?.[1];
    const satz = genannt === undefined ? leerArm : (new RegExp(`${genannt} = "([^"]*)"`).exec(LIST_TABLE)?.[1] ?? "");

    assert.match(satz, /Niemand hinterlegt/, "an empty seat stopped reading as a sentence");
  });

  /* Both halves or neither: a `<Form>` with no `validationErrors` shows a server refusal nowhere,
     and its `formRef` is what moves focus onto a refused box. An `action` would reset every
     controlled field (frontend spec I32). */
  it("renders the one field-error map through a form the hook can reach", () => {
    assert.match(FORM_SOURCE, /<Form\b/, "the editor renders no form");
    assert.match(FORM_SOURCE, /ref=\{formRef\}/, "the hook cannot reach the form");
    assert.match(FORM_SOURCE, /validationErrors=\{fieldErrors\}/, "the field errors reach no form");
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
    assert.ok(OFFER_UNDO.includes('endpoint: "/api/admin/kontakte/undo"'), "the undo dispatches somewhere other than its own route");
    // A `fetch` and not a server action: the press lands after this component has unmounted, which is
    // the whole of why the eight undos are route handlers at all.
    assert.match(DISPATCH, /await fetch\(endpoint, \{/, "the shared dispatch no longer posts over fetch");
    assert.ok(!DISPATCH.includes('"use server"'), "the undo went back to a server action while E592 still reproduces");
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
    assert.match(SUBMIT, /offerUndo\(\{/, "the undo offer is scoped to some saves rather than every one");
  });
});

describe("what the undo says when it cannot run", () => {
  /* Backend I36 (`docs/backend/spec.md`) admits a malformed address on READ, and such a block is no
     legal write. The spine can only answer that body with a reload, so the caller — which alone
     holds the payload and the reason — diagnoses first. */
  // The diagnosis itself: `fl_frontend/src/features/kontakte/utils.test.ts :: describeUnrestorableKontakte`.
  it("diagnoses an unrestorable block itself rather than dispatching it", () => {
    assert.match(OFFER_UNDO, /unrestorable: describeUnrestorableKontakte\(undoPayload\),/, "the offer no longer judges its own payload");
    const judgedAt = DISPATCH.indexOf("if (unrestorable !== null)");
    const dispatchedAt = DISPATCH.indexOf("postUndo(endpoint, body)");
    assert.ok(judgedAt !== -1 && dispatchedAt !== -1 && judgedAt < dispatchedAt, "the payload is judged after the dispatch it would spare");
    assert.match(DISPATCH, /if \(unrestorable !== null\) \{[\s\S]*?return;/, "an unrestorable block is dispatched anyway");
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
    // Never „Personen“: `trainer_ist_zugleich` seats one person twice, so the entries are what
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

  /* A row is one club's three seats, edited together, so its control opens this editor and not the
     club's. The template is READ rather than matched whole: the destination and the season are what
     must hold, not a variable's name. */
  it("points every row of the list at this editor, with the season riding along", () => {
    const href = /href=\{withSaisonId\(`(\/admin\/kontakte\/[^`]*)`, (\w+)\)\}/.exec(LIST_TABLE);

    assert.ok(href !== null, "the list offers no link into this editor");
    assert.match(href[1]!, /^\/admin\/kontakte\/\$\{\w+\.teamId\}$/, "a row opens the wrong destination");
    // Composed through the shared helper, which is what resolves the `?`/`&` split for every table.
    assert.match(href[2]!, /[Ss]aison/, "the row link is composed without the season it was pressed in");
    assert.ok(!LIST_TABLE.includes("/admin/teams/${"), "a row still links to the club editor for its contacts");
  });
});

describe("how the editor clears a season's contact block", () => {
  /* A switch that answers „hinterlegt“ and silently drops three people is destructive work wearing a
     toggle's shape. The deletion says what it does, and it is the one path that writes the null. */
  it("offers no toggle that empties the block as a side effect", () => {
    assert.ok(!SECTION.includes("Kontakte hinterlegt"), "the block toggle is back, and it deletes on the way off");
    assert.ok(!SECTION.includes("toggleBlock"), "the block toggle's logic is back");
  });

  /* Its own red section, and LAST: every editor puts its destructive section at the bottom, and this
     one was fixed on the Team editor the same day. */
  it("puts the deletion in its own section, after everything the form edits", () => {
    assert.match(
      FORM_SOURCE,
      /\{storedMembership !== null && \(\s*<FormKontakteLoeschenSection/,
      "the deletion renders on a condition other than the junction row existing",
    );
    assert.ok(
      FORM_SOURCE.indexOf("<FormKontakteLoeschenSection") > FORM_SOURCE.indexOf("<FormKontakteSection"),
      "the deletion sits above the fields it deletes",
    );
    assert.match(LOESCHEN, /formPanel\(\{ tone: hasStored \? "danger" : "neutral" \}\)/, "the deletion is not graded as destructive");
  });

  /* A person's erasure is keyed on an ADDRESS across every season and both collections. This clears
     ONE junction row. Merging them would answer a request to be forgotten by emptying one season. */
  it("clears this season's block and never reaches a person's erasure", () => {
    assert.ok(!LOESCHEN.includes("eraseKontaktperson"), "the section reaches for the erasure action");
    assert.ok(!LOESCHEN.includes("email"), "the section is keyed on an address rather than on this row");
    assert.match(LOESCHEN, /Saison-Zugehörigkeit/, "the section does not say which record it clears");
  });
});

describe("how the editor asks which person the Trainer is", () => {
  /* The DIRECTION is the thing that was unreadable. „Zugleich“ names the flag and gets read as „who
     else is the Trainer also“, which is the way round the mirror does NOT run. */
  it("asks who the Trainer is, and never who else is also the Trainer", () => {
    assert.match(TRAINER_ZUGLEICH_FRAGE, /Trainer/, "the question no longer names the Trainer as its subject");
    assert.doesNotMatch(TRAINER_ZUGLEICH_FRAGE, /zugleich/i, "the question names the flag again instead of the consequence");
  });

  /* Every answer completes the question as one sentence, which is what carries the direction: the named
     seat IS the Trainer, so that seat's details are what the Trainer's boxes read. */
  it("offers answers that complete the question as a sentence", () => {
    assert.ok(TRAINER_ZUGLEICH_OPTIONS.length >= 3, "the picker no longer offers all three answers");

    for (const option of TRAINER_ZUGLEICH_OPTIONS) {
      assert.match(option.label, /^(Eine|Die)\b/, `„${option.label}“ does not complete „${TRAINER_ZUGLEICH_FRAGE}“`);
      assert.doesNotMatch(option.label, /zugleich|sonst/i, `„${option.label}“ answers a question about the flag`);
    }
  });

  /* The picker belongs to the Trainer seat, which is what it defines. On the block header it read as a
     property of the whole block rather than of the person it fills in. */
  it("renders the picker inside the Trainer seat and nowhere else", () => {
    assert.match(SECTION, /rolle === "trainer" \? \( <TrainerZugleichPicker/, "the picker is not bound to the Trainer seat");
    assert.equal((SECTION.match(/<TrainerZugleichPicker/g) ?? []).length, 1, "the picker renders more than once");
  });
});

describe("which consent wording a record cites", () => {
  /* The version NAMES the text. Kept apart, a rewording without a bump leaves every earlier record
     claiming agreement to a text nobody was shown, and nothing anywhere would catch it. */
  it("keeps the version in the same object as the wording it names", () => {
    const CORE = readFileSync(path.resolve(SRC, "core", "einwilligung.ts"), "utf8");
    const objekt = /export const LIGA_EINWILLIGUNG = \{([\s\S]*?)\} as const;/.exec(CORE)?.[1] ?? "";

    assert.notEqual(objekt, "", "the league's consent constant is gone or no longer one object");
    assert.match(objekt, /textVersion:/, "the object names no version");
    assert.match(objekt, /text:/, "the object carries no wording for the version to name");
  });

  /* Both surfaces gather the SAME consent, so a copy per feature is two texts that drift and two
     versions that disagree about which one a record cites. */
  it("is read from that one place by both surfaces", () => {
    for (const [name, file] of [
      ["the public form", path.resolve(SRC, "features", "bewerbungen", "utils.ts")],
      ["the admin editor", path.resolve(SRC, "features", "teams", "utils.ts")],
    ] as const) {
      assert.match(readFileSync(file, "utf8"), /LIGA_EINWILLIGUNG/, `${name} stamps a version of its own`);
    }
  });

  /* Typed by hand, the version is a value nobody decided stored as though somebody had — and an edit
     to a STORED one would rewrite which text that person agreed to, which is history. */
  it("never lets the version be typed, on a new record or a stored one", () => {
    const feld = /<TextField[^>]*isReadOnly[\s\S]{0,400}?einwilligung\.text_version[\s\S]*?<\/TextField>/.exec(SECTION_SOURCE)?.[0] ?? "";

    assert.notEqual(feld, "", "the Fassung field is no longer read-only");
    assert.match(feld, /onChange=\{\(\) => undefined\}/, "the Fassung field still writes what is typed into it");
    assert.doesNotMatch(feld, /setEinwilligung\(\{ text_version/, "the Fassung field still edits the stored version");
  });
});

describe("how the editor divides one person from the next", () => {
  /* Two depths drawn the same way is the defect: a rule between two people looked like the rule
     between a person's details and their agreement, so neither read as a boundary. */
  it("gives every seat its own panel rather than a rule inside one", () => {
    /* The panel and its heading, not what the heading holds: pinning the contents made adding the
       seat's own info icon read as the panel being lost. */
    assert.match(
      SECTION,
      /<section className=\{panel\.root\(\)\}> <div className=\{panel\.header\(\)\}> <PanelHeading className=\{panel\.heading\(\)\}/,
      "a seat is drawn as something other than its own panel",
    );
    assert.doesNotMatch(SECTION, /border-t pt-5 first:border-t-0/, "the seats are back to being slices of one panel");
  });

  /* An empty card carrying a title and nothing else is what the block heading had become once each
     seat had a card of its own. */
  it("raises no block panel above the seats", () => {
    // Any spelling of the heading slot, not just `panel.`: `formPanel().heading()` renders the same
    // title and would otherwise slip past.
    assert.doesNotMatch(SECTION, /heading\(\)\} title="Kontakte"/, "the empty block heading is back above the seats");
  });

  /* One explanation per seat, on the seat: the three answer different questions, and a reader at a
     seat should not have to look elsewhere to learn which. */
  it("explains each seat on its own heading", () => {
    assert.match(SECTION, /SEAT_HINT\[rolle\]/, "the seats carry no explanation of their own");

    for (const rolle of ["trainer", "ansprechperson", "stellvertretung"]) {
      // A plain substring, not a built regex: an unescaped paren there is an unterminated group.
      assert.ok(SECTION.includes(`${rolle}: ( <Hint`), `the ${rolle} seat has no hint of its own`);
    }
  });

  /* The lighter rule stays where it belongs: INSIDE a person, between their details and the
     agreement. One depth, one drawing. */
  it("keeps exactly one rule inside a seat, for the agreement", () => {
    const regeln = [...SECTION_SOURCE.matchAll(/border-t pt-\d/g)];

    assert.equal(regeln.length, 1, `the seat draws ${String(regeln.length)} rules where the agreement needs one`);
  });
});

describe("what the two destructive controls do to the page", () => {
  /* Both write on the server and then re-read the page, so an unsaved draft would be diffed against a
     baseline that moved underneath it. Every one-way control here guards the same way. */
  it("refuses to write over unsaved work, on both", () => {
    for (const [name, source] of [
      ["the person's erasure", ERASURE],
      ["the season's clear", LOESCHEN],
    ] as const) {
      assert.match(source, /if \(!guardAgainstDraft\(isDirty, DRAFT_IN_THE_WAY\)\) return;/, `${name} writes over an unsaved draft`);
    }
  });

  /* The row is the team BEING IN the season, so clearing its contacts cannot remove it. Navigating to
     a list that still shows the entry would read as a failed delete. */
  it("stays on the page and re-reads it, on both", () => {
    for (const [name, source] of [
      ["the person's erasure", ERASURE],
      ["the season's clear", LOESCHEN],
    ] as const) {
      assert.match(source, /router\.refresh\(\);/, `${name} does not re-read the row it just changed`);
      assert.doesNotMatch(source, /router\.(replace|push)\(/, `${name} navigates away from a page that still has content`);
    }
  });

  /* Two presses, never one: both are one-way, and `useTwoPressConfirm` is what every other one-way
     control in the admin confirms through. */
  it("confirms before it writes, on both", () => {
    for (const [name, source] of [
      ["the person's erasure", ERASURE],
      ["the season's clear", LOESCHEN],
    ] as const) {
      assert.match(source, /press\(async \(\) => \{/, `${name} writes without a confirmation step`);
      assert.match(source, /<ConfirmReveal>/, `${name} confirms without saying what it takes`);
    }
  });

  /* `POST /kontakte/erasure` refuses NOTHING, so an address matching nobody succeeds and clears zero.
     Reported as „gelöscht“, that is a lie of the quiet kind. */
  it("tells an erasure apart from a no-op", () => {
    assert.match(
      ACTIONS_SRC,
      /cleared: erasure\.cleared_kontakt_slots \+ erasure\.redacted_aktionen,/,
      "the action reports no count to judge by",
    );
    assert.match(ERASURE, /if \(res\.cleared === 0\) appToast\.warning\(/, "a write that found nothing is reported as a deletion");
  });

  /* The whole safety of moving this control off a page that showed an address onto a page that shows
     one season: without the reach spelled out it reads as clearing this seat. */
  it("states the erasure's reach where it is confirmed", () => {
    for (const label of ["Saison-Zugehörigkeiten", "Bewerbungen", "Änderungsprotokoll"]) {
      assert.ok(ERASURE.includes(`label="${label}"`), `the confirmation does not say it reaches ${label}`);
    }
    assert.match(ERASURE, /jede, in der diese Adresse steht/, "the confirmation does not say the reach is every season");
  });
});

describe("which way the claim runs, at every site that reads it", () => {
  /* ONE direction, and it landed in half the editor: the named seat is the SOURCE and the Trainer the
     copy. Run the other way, the source seat rendered read-only while whatever was typed into the
     Trainer was overwritten at save. */
  it("reads out the TRAINER, never the seat the claim names", () => {
    assert.match(
      SECTION,
      /const isMirrored = \(rolle: KontaktRolle\) => rolle === "trainer" && mirroredSeat !== null;/,
      "the source seat is the one rendered read-only, so the person cannot be edited anywhere",
    );
  });

  /* A blur judges `buildPayload()`, which is composed. Spread raw, a pick was judged against the
     unmirrored draft, so the two disagreed about who the Trainer is. */
  it("judges a pick against the block the save would write", () => {
    assert.match(
      FORM_SOURCE,
      /kontakte: selected\.kontakte === null \? null : mirrorKontakte\(selected\.kontakte\)/,
      "a pick is judged against the raw draft while a blur is judged against the composed block",
    );
  });

  /* Emptying the seat the claim names empties the composed Trainer with it. Read off the raw draft,
     the banner would not name the seat the save is about to clear. */
  it("warns about the seats the composed block empties", () => {
    assert.match(
      FORM_SOURCE,
      /emptiedSeatLabels\(storedKontakte, kontakte === null \? null : mirrorKontakte\(kontakte\)\)/,
      "the banner reads the raw draft, so a seat the save clears goes unnamed",
    );
  });

  /* The admin editor and the public form run one direction through one function. Divergence here is
     what this whole case was. */
  it("runs the same direction as the public form's own judgement", () => {
    const oeffentlich = readFileSync(path.resolve(SRC, "features", "bewerbungen", "utils.ts"), "utf8");

    for (const [name, source] of [
      ["the admin editor", readFileSync(path.resolve(import.meta.dirname, "utils.ts"), "utf8")],
      ["the public form", oeffentlich],
    ] as const) {
      assert.match(
        source,
        /\.filter\(\(path\) => path\.startsWith\(`kontakte\.\$\{mirroredSeat\}\.`\)\)|\.filter\(\(path\) => path\.startsWith\(`kontakte\.\$\{mirroredSeat\}\.`\),/,
        `${name} judges the claim's copies the other way round`,
      );
    }
  });
});
