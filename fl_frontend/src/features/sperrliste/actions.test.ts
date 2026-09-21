import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { underNext } from "@/shared/testing/nextContexts.ts";
import { declaredCodes, sliceBetween } from "@/shared/testing/refusalRegister.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

import { FLPostSperrlistePayloadSchema } from "./schemas.ts";

const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const PAGE_SOURCE = readFileSync(path.resolve(REPO_ROOT, "fl_frontend", "src", "app", "admin", "sperrliste", "page.tsx"), "utf8");
/** Whitespace-collapsed: the page's copy is JSX text, so the formatter picks its line breaks. */
const PAGE = PAGE_SOURCE.replace(/\s+/g, " ");

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step as it evaluates (`docs/frontend/spec.md` §1.9). */
const { default: AdminSperrlistePage } = await import("@/app/admin/sperrliste/page.tsx");

/** The page's own return. Its rows sit behind the boundary, whose fallback stands here. */
const PAGE_MARKUP = renderTree(underNext(h(AdminSperrlistePage, {}), { pathname: "/admin/sperrliste" }));

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

/* Read per slice rather than over the file: two writes live here, and a search over the whole source
   is satisfied by whichever one happens to carry the arm. */
const CREATE_ACTION = sliceBetween(ACTIONS, "export async function postSperreAction", "export async function deleteSperreAction");
const REMOVE_ACTION = sliceBetween(ACTIONS, "export async function deleteSperreAction", null);

describe("the address a unique index already holds", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/shared/testing/refusalRegister.ts :: sliceBetween`). */
  it("cuts both writes out of the file before reading them", () => {
    assert.ok(CREATE_ACTION.includes("postSperre(validated.data)"), "the create's call is outside its slice");
    assert.ok(!CREATE_ACTION.includes("deleteSperre("), "the create's slice runs on into the removal");
    assert.ok(REMOVE_ACTION.includes("deleteSperre(validated.data)"), "the removal's call is outside its slice");
  });

  /* A wiring between two modules, which no render of this action can show (`docs/frontend/spec.md`
     §1.9); what the mapper answers is asked of it in `fl_frontend/src/features/sperrliste/refusals.test.ts`. */
  it("consults the mapper on the create, the one write that sends an address", () => {
    assert.ok(CREATE_ACTION.includes("mapAdresseRefusal(error)"), "the create consults no mapper, so a duplicate reaches the error page");
  });
});

describe("the ban list's writes against the backend's refusal register", () => {
  it("leaves the read and the removal with no declared rule to map", () => {
    for (const operation of ["GET /sperrliste", "DELETE /sperrliste/{sperrliste_id}"]) {
      assert.deepEqual(declaredCodes(operation), [], `${operation} declares a refusal no mapper answers`);
    }
  });

  /* The floor under the two empty lookups above: each has to mean "this operation declares none"
     rather than "the register was read as nothing at all", which a misspelled name also answers. */
  it("reads a declared refusal where one exists", () => {
    assert.deepEqual(declaredCodes("DELETE /spieler/{spieler_id}/erasure"), ["REQ-PURGE-001"]);
  });

  /* A removal whose row another administrator has already lifted answers 404, which
     `fl_frontend/src/shared/utils/actionError.ts` already words as the reload it is. */
  it("leaves the removal with no mapper of its own", () => {
    assert.doesNotMatch(REMOVE_ACTION, /serverErrorCode/, "the removal maps a code the shared reader already answers");
  });
});

/** What the box hands the action, judged by the same parse `postSperreAction` runs it through. */
const grundRefusal = (grund: string): string | undefined => {
  const parsed = FLPostSperrlistePayloadSchema.safeParse({ email: "vorstand@example.org", grund: grund });

  return parsed.success ? undefined : parsed.error.issues.find((issue) => issue.path[0] === "grund")?.message;
};

describe("the address a reason may not carry", () => {
  /* `grund` is served, copied whole into a removal's action-log image, and outlives the person's
     erasure, so an address typed there survives everywhere the stored hash keeps one out. */
  it("refuses an address standing alone and one buried in a sentence", () => {
    assert.equal(grundRefusal("zorbanax@beispielschule.de"), "Der Grund darf keine E-Mail-Adresse enthalten.");
    assert.equal(grundRefusal("Falsche Angabe, siehe zorbanax@beispielschule.de"), "Der Grund darf keine E-Mail-Adresse enthalten.");
  });

  /* A bare `@` is ordinary German prose, and refusing it would turn away the common reason to catch
     the rare one. Both ends take these, so a tightened mirror marks a box the API would not. */
  it("takes a reason whose only `@` is a word", () => {
    assert.equal(grundRefusal("Nach Absprache @ Schulleitung"), undefined);
    assert.equal(grundRefusal("Siehe Mail vom 3.4."), undefined);
  });
});

describe("the page the ban list stands on", () => {
  /* One `h1` per page and the admin shell owns it (`.claude/rules/frontend.md`), so what this page
     may raise is none. */
  it("raises no heading the shell already owns", () => {
    assert.ok(!PAGE_MARKUP.includes("<h1"), "the page's own chrome raises an h1 the shell already owns");
    /* The control that absence needs: the rows sit behind a boundary, so what renders is the
       fallback, and a page rendering nothing at all would satisfy the line above unread. */
    assert.ok(PAGE_MARKUP.includes('role="status"'), "the page's chrome renders nothing, so the absence above proves nothing");
    // The list itself renders behind the boundary, so what it returns is read rather than met.
    assert.ok(!PAGE.includes("<h1"), "the page raises an h1 the shell already owns");
  });

  /* The bar an administrator types into is the one control this page offers, and the query it takes
     is a person's address: on this route alone it is held in the page rather than written to `?q=`. */
  it("asks the shell to hold the typed query instead of writing it", () => {
    assert.match(PAGE, /<AdminCrudShell[^>]*\bprivateQuery\b/, "the bar writes the typed address into a request line nginx logs");
  });

  /* The page's chrome may never wait on the list, and the fetch below the boundary may never run in
     the image build (`.claude/rules/frontend.md`). */
  it("leaves the page's shape intact", () => {
    assert.match(PAGE, /export default function AdminSperrlistePage/, "the page's default export became async");
    // The FIRST statement, not merely a present one: the image builder reaches no backend, so a fetch
    // ordered above this call runs at build time. `[\s\S]*?` would have admitted one in between.
    assert.equal(
      // Index 1: index 0 is the function's own signature, which the cut opens on.
      statementsOf(sliceBetween(PAGE_SOURCE, "async function Sperrliste", null))[1],
      "await connection();",
      "the data component no longer opens with await connection()",
    );
  });
});
