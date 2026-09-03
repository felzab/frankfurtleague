import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries either context — `useRouter` reads the first and `useSearchParams` the
   second — and the surfaces below render under both. A Next release that moves either module fails
   this file at import rather than quietly. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { LIGA_EINWILLIGUNG } from "@/core/einwilligung";
import { buildEmptyBewerbungKontaktperson } from "@/features/bewerbungen/utils";
import { TRAINER_ZUGLEICH_FRAGE, TRAINER_ZUGLEICH_OPTIONS } from "@/features/teams/constants";
import { buildEmptyKontaktperson } from "@/features/teams/utils";
import { formPanel } from "@/shared/components/ui/formPanel";
import { resolveBlockingBanners, resolveRailBanners } from "@/shared/components/ui/railBanner";
import { renderMarkup, renderTree } from "@/shared/testing/renderTest";

import { declaredCodes, sliceBetween } from "../../core/refusalRegister.ts";
import { buildKontakteBanners } from "./components/forms/AdminKontakteEditForm/banners.ts";
import { deriveKontakteDraftStatus } from "./kontakteDraftStatus.ts";
import { teamPageHref } from "./utils.ts";

import type { FLKontaktperson, FLSaisonTeamKontakte } from "@/features/teams/schemas";
import type { AdminKontakteRow, AdminKontaktSeat } from "@/features/teams/types";
import type { ReactNode } from "react";
import type { KontakteBanner } from "./components/forms/AdminKontakteEditForm/banners.ts";

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
/** Whitespace-collapsed: the section's copy is JSX text, so the formatter picks its line breaks. */
const SECTION = SECTION_SOURCE.replace(/\s+/g, " ");

const PAGE_SOURCE = readFileSync(path.resolve(SRC, "app", "admin", "kontakte", "[team_id]", "page.tsx"), "utf8");
const PAGE = PAGE_SOURCE.replace(/\s+/g, " ");

/** The club editor, which lost the block and shows the way here instead. */
const TEAM_FORM_DIR = path.resolve(SRC, "features", "teams", "components", "forms", "AdminTeamEditForm");
const TEAM_FORM = readFileSync(path.resolve(TEAM_FORM_DIR, "AdminTeamEditForm.tsx"), "utf8");

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { FormKontakteLinkSection } = await import("@/features/teams/components/forms/AdminTeamEditForm/FormKontakteLinkSection.tsx");
const { AdminKontakteTable } = await import("@/features/teams/components/collections/AdminKontakteTable.tsx");
const { FormKontakteSection } = await import("./components/forms/AdminKontakteEditForm/FormKontakteSection.tsx");
const { AdminKontakteEditView } = await import("./components/views/AdminKontakteEditView.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");
const { default: AdminKontakteEditPage } = await import("@/app/admin/kontakte/[team_id]/page.tsx");

/** The stored shape, which the list seat takes a subset of, so one person serves both renders below. */
const ADA: FLKontaktperson = {
  vorname: "Ada",
  nachname: "Byron",
  email: "ada@example.org",
  telefon: "069 111",
  geburtsdatum: "1990-12-10",
  einwilligung: { umfang: "kontaktdaten", erteilt_von: "person", text_version: "1", datum: "2026-03-12" },
};

/** One list seat. `person: null` is what an erasure leaves, which is the state these cases are about. */
const seat = (rolle: AdminKontaktSeat["rolle"], label: string, person: AdminKontaktSeat["person"]): AdminKontaktSeat => ({
  rolle,
  label,
  person,
  istTrainerZugleich: false,
});

const listRow = (seats: readonly AdminKontaktSeat[]): AdminKontakteRow => ({
  id: "t1",
  teamId: "t1",
  teamName: "SG Alpha",
  teamShorthand: "ALP",
  seats,
  besetzt: seats.filter((each) => each.person !== null).length,
});

/**
 * `useSearchParams` reads a context and nothing else supplies one, so the table renders under the
 * provider rather than against a stubbed hook.
 */
const listMarkup = (row: AdminKontakteRow, query: string): string =>
  renderTree(
    h(
      SearchParamsContext.Provider,
      { value: new URLSearchParams(query) },
      h(AdminKontakteTable, { filteredKontakte: [row], emptiness: "none" }),
    ),
  );

/** The editor's banner author, in the one state each case below is about. */
const bannersFor = (state: Partial<Parameters<typeof buildKontakteBanners>[0]>): readonly KontakteBanner[] =>
  buildKontakteBanners({ saisonId: "2526", saisonStatus: "active", isMember: true, isBlockRemoved: false, emptiedSeatLabels: [], ...state });

const bannerIds = (banners: readonly KontakteBanner[]): string[] => banners.map((banner) => banner.id);

/** What `useRouter` hands the two destructive controls. `bfcacheId` is a value rather than a call. */
const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "",
};

/** One stored seat. The ADDRESS is what decides whether that seat offers the person's erasure. */
const seatPerson = (vorname: string, nachname: string, email: string): FLKontaktperson => ({ ...ADA, vorname, nachname, email });

/** Three seats filled in, which is the state most of the renders below are about. */
const BLOCK: FLSaisonTeamKontakte = {
  trainer: seatPerson("Ada", "Byron", "ada@example.org"),
  ansprechperson: seatPerson("Grace", "Hopper", "grace@example.org"),
  stellvertretung: seatPerson("Alan", "Turing", "alan@example.org"),
  trainer_ist_zugleich: null,
};

/** The same three without an address, so no seat offers the erasure and its own rule stays out. */
const BLOCK_OHNE_ADRESSE: FLSaisonTeamKontakte = {
  ...BLOCK,
  trainer: seatPerson("Ada", "Byron", ""),
  ansprechperson: seatPerson("Grace", "Hopper", ""),
  stellvertretung: seatPerson("Alan", "Turing", ""),
};

/** Three empty seats: what an erasure leaves, and the state neither surface may explain. */
const BLOCK_LEER: FLSaisonTeamKontakte = { trainer: null, ansprechperson: null, stellvertretung: null, trainer_ist_zugleich: null };

/**
 * The three contexts the editor's own subtree reads and no prop carries: the router both destructive
 * controls hold, the query the way out rides, and the status each field label looks itself up in.
 */
const editorTree = (node: ReactNode, kontakte: FLSaisonTeamKontakte | null): string =>
  renderTree(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
      h(
        SearchParamsContext.Provider,
        { value: new URLSearchParams("saison_id=2526") },
        h(DraftStatusProvider, {
          status: deriveKontakteDraftStatus({ stored: { kontakte }, draft: { kontakte }, fieldErrors: {} }),
          children: node,
        }),
      ),
    ),
  );

/** The seats as the admin meets them, in the state each case names. */
const sectionMarkup = (kontakte: FLSaisonTeamKontakte | null, isMember = true): string =>
  editorTree(
    h(FormKontakteSection, {
      value: kontakte,
      isMember,
      teamHref: "/admin/teams/t1?saison_id=2526",
      banners: [],
      onChange: () => undefined,
      onFieldLeft: () => undefined,
      isDirty: false,
      onValidateSelection: () => undefined,
    }),
    kontakte,
  );

/** The whole editor a reader meets: the view renders the form, and the form the seats and the deletion. */
const viewMarkup = (kontakte: FLSaisonTeamKontakte | null, hasRow = true): string =>
  editorTree(
    h(AdminKontakteEditView, {
      team: { id: "t1", name: "SG Alpha", shorthand: "ALP", inactive_since: null },
      saison: {
        saisonId: "2526",
        saisonStatus: "active",
        membership: hasRow ? { gruppe: "A", austritt: null, trikot_farbe: null, kontakte } : null,
      },
    }),
    kontakte,
  );

/** The page's own return. Its data component sits behind the boundary, whose fallback stands here. */
const PAGE_MARKUP = renderTree(
  h(AdminKontakteEditPage, { params: Promise.resolve({ team_id: "t1" }), searchParams: Promise.resolve({ saison_id: "2526" }) }),
);

/** The words a reader hears at one heading level, in the order the markup carries them. */
const headings = (html: string, level: string): string[] =>
  [...html.matchAll(new RegExp(`<${level}[^>]*>([^<]*)<`, "g"))].map((found) => found[1] ?? "");

/** Each rendered seat card, cut into the header carrying its title and the body beneath it. */
const seatCards = (html: string): { header: string; body: string }[] => {
  const panel = formPanel();

  return html
    .split(`<section class="${panel.root()}">`)
    .slice(1)
    .map((card) => {
      const [header = "", body = ""] = card.split(`<div class="${panel.body()}">`);

      return { header, body };
    });
};

/* What is asserted of the undo is which site carries a step — where the payload is judged, which
   mutation restores it — and a call reports an outcome rather than the site. */
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
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/core/refusalRegister.ts :: sliceBetween`). */
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
    const editor = viewMarkup(BLOCK);

    assert.ok(!editor.includes("<h1"), "the editor raises an h1 the shell already owns");
    // The control: an editor rendering no title at all would satisfy the absence above.
    assert.ok(headings(editor, "h2").includes("Trainer"), "the editor renders no seat title, so the absence above proves nothing");
    assert.ok(!PAGE_MARKUP.includes("<h1"), "the page's own chrome raises an h1 the shell already owns");
    /* The page's remaining half is its data component, which sits behind the boundary the chrome
       renders: what stands in the markup above is the fallback, so what it wraps the view in is read. */
    assert.ok(!PAGE.includes("<h1"), "the page raises an h1 the shell already owns");
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
    const CLAIMS = ["gelöscht", "entfernt worden", "nicht mehr", "unbekannt", "keine Angabe"];
    // Both states of the editor's own seats: an emptied one, and the filled one it is read against.
    for (const [wo, html] of [
      ["an empty seat", sectionMarkup(BLOCK_LEER)],
      ["a filled seat", sectionMarkup(BLOCK)],
    ] as const) {
      for (const claim of CLAIMS) assert.ok(!html.includes(claim), `the editor says „${claim}“ at ${wo}, which the row records no field for`);
    }
    // Nothing beneath the switch: an empty seat renders no sub-heading of its own, the agreement's included.
    assert.deepEqual(headings(sectionMarkup(BLOCK_LEER), "h4"), [], "an empty seat renders something beneath its switch");

    const seats = [
      seat("trainer", "Trainer", ADA),
      seat("ansprechperson", "Ansprechperson", null),
      seat("stellvertretung", "Stellvertretung", null),
    ];
    const leer = listMarkup(listRow(seats), "");
    const times = (needle: string) => leer.split(needle).length - 1;

    /* The occupied seat is the control: a list rendering no seat at all would satisfy every negative
       check below. Counted against each other rather than against a number, because the phone cards
       and the table each render all three. */
    assert.ok(times("Ada Byron") > 0, "the list renders no seat at all, so the empty ones prove nothing");
    assert.equal(times("Niemand hinterlegt"), 2 * times("Ada Byron"), "an empty seat stopped reading as a sentence, or borrowed a person");

    for (const claim of ["gelöscht", "entfernt worden", "nicht mehr", "unbekannt", "keine Angabe"]) {
      assert.ok(!leer.includes(claim), `the list says „${claim}“ about a seat, which the row records no field for`);
    }
  });

  /* Both halves or neither: `validationErrors` shows a server refusal, `formRef` moves focus onto it
     (frontend spec I32). That there is a form at all, and that it passes no `action`, is every draft
     form's at `fl_frontend/src/shared/components/ui/formSubmit.test.ts`. */
  it("renders the one field-error map through a form the hook can reach", () => {
    assert.match(FORM_SOURCE, /ref=\{formRef\}/, "the hook cannot reach the form");
    assert.match(FORM_SOURCE, /validationErrors=\{fieldErrors\}/, "the field errors reach no form");
    // Which handler, not merely that one is wrapped: the sweep above accepts any.
    assert.match(FORM_SOURCE, /onSubmit=\{runOnSubmit\(requestSave\)\}/, "the form submits something other than the guarded save");
  });

  /* Both gates of the reused-tree defect, and neither is sufficient alone: the key above re-seeds a
     reopened editor, and this reset is what makes a tree the router kept alive honest. */
  it("resets the draft on both exits", () => {
    assert.match(SUBMIT, /resetDraftToStored\(\);\s*\n\s*leavePage\(\);/, "a save leaves typed values standing in the tree");
    assert.match(FORM_SOURCE, /const discardAndLeave = \(\) => \{\s*\n\s*resetDraftToStored\(\);/, "a discard leaves typed values standing");
  });

  /* Unsaved work may not leave unasked. No markup carries which handler a control was given, so what
     is asserted is the handler's SHAPE — the whole body, so a guard weakened into a no-op still fails. */
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
  /* `resolveBlockingBanners` takes the non-info banners raised by the CHANGE, so the two removals are
     what open the save dialog — and a standing situation, however grave, asks nothing. */
  it("puts the two removals in front of the save dialog and neither situation", () => {
    const severities = (state: Parameters<typeof bannersFor>[0]) => bannersFor(state).map((banner) => banner.severity);

    for (const state of [{ isBlockRemoved: true }, { emptiedSeatLabels: ["Trainer"] }]) {
      assert.deepEqual(severities(state), ["warning"], `${JSON.stringify(state)} raises nothing, or grades a removal as ordinary`);
      assert.notEqual(resolveBlockingBanners(bannersFor(state)), null, `${JSON.stringify(state)} saves without confirming what it clears`);
    }

    for (const state of [{ isMember: false }, { saisonStatus: "past" as const }]) {
      /* Each grade asserted outright, which is also the floor: `null` below reads the same for a
         situation correctly let through and for a state that raised nothing at all. */
      assert.deepEqual(severities(state), ["info"], `${JSON.stringify(state)} raises nothing, or grades a standing state as a warning`);
      assert.equal(resolveBlockingBanners(bannersFor(state)), null, `${JSON.stringify(state)} confirms a situation the save did not cause`);
    }
  });

  /* The block's own removal takes every seat with it, so the per-seat sentence beneath it would name
     seats inside a block that is going whole. */
  it("drops the per-seat sentence where the whole block goes", () => {
    const [entfernt, ...beside] = bannersFor({ isBlockRemoved: true, emptiedSeatLabels: ["Trainer", "Ansprechperson"] });

    assert.equal(entfernt?.id, "kontakte.block-removed");
    assert.deepEqual(bannerIds(beside), [], "the whole block's removal is stated beside a sentence about seats inside it");

    // Declared as well as unraised: without it the rail would show both the day either is raised alone.
    const paar = [...bannersFor({ emptiedSeatLabels: ["Trainer"] }), ...bannersFor({ isBlockRemoved: true })];

    assert.deepEqual(entfernt?.supersedes, ["kontakte.seats-emptied"]);
    assert.deepEqual(bannerIds(resolveRailBanners(paar)), ["kontakte.block-removed"]);
  });

  /* No count in a sentence that would have to agree with it: the seats are read out in the body
     instead, which is what keeps the wording right for one seat and for three. */
  it("names the emptied seats in a readout rather than counting them", () => {
    const [einer] = bannersFor({ emptiedSeatLabels: ["Trainer"] });
    const [drei] = bannersFor({ emptiedSeatLabels: ["Trainer", "Ansprechperson", "Stellvertretung"] });

    assert.equal(einer?.body, "Betroffen: Trainer.");
    assert.equal(drei?.body, "Betroffen: Trainer, Ansprechperson, Stellvertretung.");
    for (const banner of [einer, drei]) {
      assert.doesNotMatch(`${banner?.title ?? ""} ${banner?.body ?? ""}`, /\d/, "the banner counts the seats in a sentence that must agree");
    }
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
    const block = (held: number): FLSaisonTeamKontakte => ({
      trainer: held > 0 ? ADA : null,
      ansprechperson: held > 1 ? ADA : null,
      stellvertretung: null,
      trainer_ist_zugleich: null,
    });
    const linkText = (kontakte: FLSaisonTeamKontakte | null): string =>
      /<a [^>]*>(.*?)<\/a>/s.exec(renderMarkup(FormKontakteLinkSection, { saisonId: "2526", kontakte, href: "/admin/kontakte/t1" }))?.[1] ?? "";

    /* An erasure leaves a block whose seats are empty, so an emptied block and an absent one read the
       same: a count off the block's presence would call the first of these three. */
    assert.equal(linkText(null), "Kontakte für Saison 2526 hinterlegen");
    assert.equal(linkText(block(0)), "Kontakte für Saison 2526 hinterlegen");
    assert.equal(linkText(block(1)), "1 Kontakteintrag für Saison 2526 bearbeiten");
    assert.equal(linkText(block(2)), "2 Kontakteinträge für Saison 2526 bearbeiten");
  });

  /* The editor's own way back out, which the list's link and the club editor's each carry too. What
     the builder returns is `fl_frontend/src/features/kontakte/utils.test.ts :: teamPageHref`. */
  it("sends the panel's way out through the builder that carries the season", () => {
    // Rendered where the club has no junction row, which is the state the way out exists for.
    const wegRaus = /<a [^>]*href="([^"]*)"[^>]*>Zur Seite des Teams</.exec(viewMarkup(null, false))?.[1] ?? "";

    assert.equal(wegRaus, teamPageHref("t1", "2526"), "the way out is spelled a second time, or lost the season");
  });

  /* One noun for one concept: `Saison-Zugehörigkeit` is what the admin surface calls a junction row,
     and a second word for it inside one slice reads as a second thing. */
  it("calls the junction row by the admin surface's own noun", () => {
    const [ohneZeile] = bannersFor({ isMember: false });

    assert.match(
      ohneZeile?.body ?? "",
      /Kontakte werden bei der Saison-Zugehörigkeit hinterlegt/,
      "the banner renamed the row the seats hang off",
    );
    assert.ok(!viewMarkup(BLOCK).includes("Saisonteilnahme"), "the editor carries a second noun for the junction row");
    // Every state the banner author can be in, since a rail banner is composed rather than rendered here.
    for (const state of [
      {},
      { isMember: false },
      { saisonStatus: "past" as const },
      { isBlockRemoved: true },
      { emptiedSeatLabels: ["Trainer"] },
    ])
      for (const banner of bannersFor(state))
        assert.ok(!`${banner.title} ${banner.body ?? ""}`.includes("Saisonteilnahme"), "a banner carries a second noun for the junction row");
  });

  /* A row is one club's three seats, edited together, so its control opens this editor and not the
     club's — and the season it was pressed in rides along, the seats being season-scoped. */
  it("points every row of the list at this editor, with the season riding along", () => {
    const hrefs = (query: string) => [
      ...new Set([...listMarkup(listRow([seat("trainer", "Trainer", ADA)]), query).matchAll(/href="([^"]*)"/g)].map((found) => found[1])),
    ];

    assert.deepEqual(hrefs("saison_id=2526"), ["/admin/kontakte/t1?saison_id=2526"]);
    // The season the sidemenu holds is the whole of what rides along; every other filter stays behind.
    assert.deepEqual(hrefs("saison_id=2526&q=alpha&besetzung=leer"), ["/admin/kontakte/t1?saison_id=2526"]);
    // Absent rather than empty: `?saison_id=` would read as a season nobody picked.
    assert.deepEqual(hrefs("q=alpha"), ["/admin/kontakte/t1"]);
  });
});

describe("how the editor clears a season's contact block", () => {
  /* A switch that answers „hinterlegt“ and silently drops three people is destructive work wearing a
     toggle's shape. The deletion says what it does, and it is the one path that writes the null. */
  it("offers no toggle that empties the block as a side effect", () => {
    const seiten = sectionMarkup(BLOCK);

    assert.ok(!seiten.includes("Kontakte hinterlegt"), "the block toggle is back, and it deletes on the way off");
    // The control: one switch per seat is what stayed, so a render carrying none proves nothing above.
    assert.ok(seiten.includes("Trainer hinterlegt"), "the seats render no switch at all");
    assert.ok(!SECTION.includes("toggleBlock"), "the block toggle's logic is back");
  });

  /* Its own red section, and LAST: every editor puts its destructive section at the bottom, and this
     one was fixed on the Team editor the same day. */
  it("puts the deletion in its own section, after everything the form edits", () => {
    const editor = viewMarkup(BLOCK);

    assert.ok(editor.includes("Kontakte dieser Saison löschen"), "the deletion is not offered on a season the club has contacts in");
    assert.ok(
      editor.indexOf("Kontakte dieser Saison löschen") > editor.indexOf("Trainer hinterlegt"),
      "the deletion sits above the fields it deletes",
    );
    // The recipe's own danger classes, so a panel regraded centrally moves with it.
    assert.ok(editor.includes(`<section class="${formPanel({ tone: "danger" }).root()}">`), "the deletion is not graded as destructive");
    // Nothing stored is nothing at stake, so the grade is spent nowhere.
    assert.ok(!viewMarkup(null).includes("border-danger/30"), "an empty block is graded as destructive");
    assert.ok(
      !viewMarkup(null, false).includes("Kontakte dieser Saison löschen"),
      "the deletion renders on a condition other than the junction row existing",
    );
  });

  /* A person's erasure is keyed on an ADDRESS across every season and both collections. This clears
     ONE junction row. Merging them would answer a request to be forgotten by emptying one season. */
  it("clears this season's block and never reaches a person's erasure", () => {
    assert.ok(!LOESCHEN.includes("eraseKontaktperson"), "the section reaches for the erasure action");
    assert.ok(!LOESCHEN.includes("email"), "the section is keyed on an address rather than on this row");

    const editor = viewMarkup(BLOCK);

    assert.match(
      editor.slice(editor.indexOf("Kontakte dieser Saison löschen")),
      /Saison-Zugehörigkeit/,
      "the section does not say which record it clears",
    );
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
    const seiten = sectionMarkup(BLOCK);

    assert.deepEqual(
      seatCards(seiten).map((card) => card.body.includes(TRAINER_ZUGLEICH_FRAGE)),
      [true, false, false],
      "the picker is not bound to the Trainer seat",
    );
    // The control the answer is written into, which one press may claim for one seat only.
    assert.equal(seiten.split('name="kontakte.trainer_ist_zugleich"').length - 1, 1, "the picker renders more than once");
  });
});

describe("which consent wording a record cites", () => {
  /* The version NAMES the text. Kept apart, a rewording without a bump leaves every earlier record
     claiming agreement to a text nobody was shown. */
  it("keeps a version and the wording it names, both filled in", () => {
    // That the two are one object is this file's type error; what no type can say is that neither
    // half is a placeholder.
    assert.notEqual(LIGA_EINWILLIGUNG.textVersion, "", "the version is empty, so every record cites nothing");
    assert.notEqual(LIGA_EINWILLIGUNG.text, "", "the version names no wording");
  });

  /* Both surfaces gather the SAME consent, so a copy per feature is two texts that drift and two
     versions that disagree about which one a record cites. */
  it("stamps that one version on a new record from either surface", () => {
    assert.equal(buildEmptyKontaktperson().einwilligung.text_version, LIGA_EINWILLIGUNG.textVersion, "the admin editor stamps its own version");
    assert.equal(
      buildEmptyBewerbungKontaktperson().einwilligung.text_version,
      LIGA_EINWILLIGUNG.textVersion,
      "the public form stamps its own version",
    );
    // The identifier as well as the value: a literal that happens to agree today drifts on the next bump.
    for (const [name, file] of [
      ["the public form", path.resolve(SRC, "features", "bewerbungen", "utils.ts")],
      ["the admin editor", path.resolve(SRC, "features", "teams", "utils.ts")],
    ] as const) {
      assert.match(readFileSync(file, "utf8"), /LIGA_EINWILLIGUNG/, `${name} spells the version rather than reading it`);
    }
  });

  /* Typed by hand, the version is a value nobody decided stored as though somebody had — and an edit
     to a STORED one would rewrite which text that person agreed to, which is history. */
  it("never lets the version be typed, on a new record or a stored one", () => {
    const box = /<input[^>]*name="kontakte\.trainer\.einwilligung\.text_version"[^>]*>/.exec(sectionMarkup(BLOCK))?.[0] ?? "";

    assert.notEqual(box, "", "the Fassung field is no longer rendered at all");
    assert.match(box, /readonly=""/i, "the Fassung field is no longer read-only");

    // Both handlers, which no markup carries: read-only stops the caret, and a write reaching the
    // field by either handler would still rewrite which text a stored record cites.
    const feld = /<TextField[^>]*isReadOnly[\s\S]{0,400}?einwilligung\.text_version[\s\S]*?<\/TextField>/.exec(SECTION_SOURCE)?.[0] ?? "";

    assert.match(feld, /onChange=\{\(\) => undefined\}/, "the Fassung field still writes what is typed into it");
    assert.doesNotMatch(feld, /setEinwilligung\(\{ text_version/, "the Fassung field still edits the stored version");
  });
});

describe("how the editor divides one person from the next", () => {
  /* Two depths drawn the same way is the defect: a rule between two people looked like the rule
     between a person's details and their agreement, so neither read as a boundary. */
  it("gives every seat its own panel rather than a rule inside one", () => {
    const panel = formPanel();
    const cards = seatCards(sectionMarkup(BLOCK));

    // The recipe's own classes rather than a copy of them: a seat drawn at the call site drifts from
    // every other panel with nothing able to see it.
    assert.equal(cards.length, 3, "a seat is drawn as something other than its own panel");
    for (const { header } of cards) {
      assert.ok(header.startsWith(`<div class="${panel.header()}">`), "a seat's panel opens on something other than the panel header");
      // The heading slot, not what the heading holds: pinning the contents made adding the seat's
      // own info icon read as the panel being lost.
      assert.ok(header.includes(`<h2 class="${panel.heading()}`), "a seat spells its own heading again");
    }
    assert.ok(!sectionMarkup(BLOCK).includes("border-t pt-5 first:border-t-0"), "the seats are back to being slices of one panel");
  });

  /* An empty card carrying a title and nothing else is what the block heading had become once each
     seat had a card of its own. */
  it("raises no block panel above the seats", () => {
    // The whole panel-title estate rather than one spelling: any panel above the seats is a fourth
    // heading here, whatever it is called.
    assert.deepEqual(
      headings(sectionMarkup(BLOCK), "h2"),
      ["Trainer", "Ansprechperson", "Stellvertretung"],
      "a panel above the seats is back, or a seat lost its own",
    );
  });

  /* One explanation per seat, on the seat: the three answer different questions, and a reader at a
     seat should not have to look elsewhere to learn which. */
  it("explains each seat on its own heading", () => {
    // Off the HEADER of each card: a hint in the body would be an explanation a reader meets after
    // the fields it is about.
    const hinweise = seatCards(sectionMarkup(BLOCK)).map((card) => /aria-label="([^"]*)"/.exec(card.header)?.[1] ?? "");

    assert.equal(hinweise.length, 3, "the seats carry no cards of their own, so this compares nothing");
    assert.equal(new Set(hinweise).size, 3, `two seats share one explanation, or a seat carries none: ${hinweise.join(" | ")}`);
    for (const hinweis of hinweise) assert.match(hinweis, /^Hinweis zu/, `„${hinweis}“ is no explanation of a seat`);
  });

  /* The lighter rule stays where it belongs: INSIDE a person, between their details and the
     agreement. One depth, one drawing. */
  it("keeps exactly one rule inside a seat, for the agreement", () => {
    /* No address in any seat, so none offers the person's erasure: that control draws its own rule
       from its own file, and what this case is about is the division inside one person. */
    for (const { body } of seatCards(sectionMarkup(BLOCK_OHNE_ADRESSE))) {
      const regeln = [...body.matchAll(/class="[^"]*\bborder-t pt-\d[^"]*"/g)].map((found) => found[0]);

      assert.equal(regeln.length, 1, `the seat draws ${String(regeln.length)} rules where the agreement needs one`);
      assert.match(
        body.split(regeln[0] ?? "")[1] ?? "",
        /^><h4[^>]*>Einwilligung</,
        "the seat's one rule opens something other than the agreement",
      );
    }
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
    assert.match(ACTIONS, /cleared: erasure\.cleared_kontakt_slots \+ erasure\.redacted_aktionen,/, "the action reports no count to judge by");
    assert.match(ERASURE, /if \(res\.cleared === 0\) appToast\.warning\(/, "a write that found nothing is reported as a deletion");
  });

  /* The whole safety of moving this control off a page that showed an address onto a page that shows
     one season: without the reach spelled out it reads as clearing this seat. */
  it("states the erasure's reach where it is confirmed", () => {
    // What the SECOND press reveals, which is a state the resting control has not reached.
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
    const box = (html: string, rolle: string): string =>
      new RegExp(`<input[^>]*name="kontakte\\.${rolle}\\.vorname"[^>]*>`).exec(html)?.[0] ?? "";
    const gespiegelt = sectionMarkup({ ...BLOCK, trainer_ist_zugleich: "ansprechperson" });

    assert.match(box(gespiegelt, "trainer"), /readonly=""/i, "the Trainer takes input while another seat is the source");
    assert.doesNotMatch(
      box(gespiegelt, "ansprechperson"),
      /readonly=""/i,
      "the source seat is the one rendered read-only, so the person cannot be edited anywhere",
    );
    // The control: with no claim standing, neither seat reads out.
    assert.doesNotMatch(box(sectionMarkup(BLOCK), "trainer"), /readonly=""/i, "the Trainer reads out with no claim standing");
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
