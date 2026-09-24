import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { underNext } from "@/shared/testing/nextContexts.ts";
import { assertEachAnswered, publishedRefusals } from "@/shared/testing/publishedRefusals.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";
import { sliceBetween } from "@/shared/testing/sourceText.ts";

import { mapAdresseRefusal } from "./refusals.ts";
import { FLPostSperrlistePayloadSchema } from "./schemas.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

const EVENTS = "__flSperreEvents";
const SENT = "__flSperreSentMail";
const POSTED = "__flSperrePosted";
const ANSWER = "__flSperrePostAnswer";
const SEND_FAILS = "__flSperreSendFails";

const asDataUrl = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

/* The ORDER between the write and the send decides whether somebody is told they are barred by a
   request that then failed, and no render shows it (`docs/frontend/spec.md` §1.9). Each double
   appends to one list, read instead of the source. */
const MUTATIONS_DOUBLE = `export const postSperre = async (payload) => {
  globalThis.${EVENTS}.push("post");
  globalThis.${POSTED}.push(payload);
  const answer = globalThis.${ANSWER};
  return typeof answer === "function" ? answer() : answer;
};
export const deleteSperre = async () => {
  globalThis.${EVENTS}.push("delete");
  return { acknowledged: 1, sperrliste_id: "6890a1b2c3d4e5f607190001" };
};`;

const MAIL_DOUBLE = `export const sendMail = async (message) => {
  globalThis.${EVENTS}.push("mail");
  if (globalThis.${SEND_FAILS}) throw new Error("the provider refused the message");
  globalThis.${SENT}.push(message);
  return { id: null };
};`;

const AUTH_DOUBLE = `export const getAdminSession = async () => ({ user: { email: "vorstand@example.org" } });`;

const HEADERS_DOUBLE = `export const headers = async () => new Headers();`;

/* `refresh()` throws outside a request Next itself is rendering, and what a case here asks of it is
   that the action reached it at all. */
const CACHE_DOUBLE = `export const refresh = () => { globalThis.${EVENTS}.push("refresh"); };`;

const LOGGING_DOUBLE = `export const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };`;

const CONFIG_DOUBLE = `export const frontend_config = { AUTH_URL: "http://localhost:3000", LOG_LEVEL: "ERROR", LOG_FORMAT: "json" };`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    if (specifier === "next/cache") return { url: asDataUrl(CACHE_DOUBLE), shortCircuit: true };
    if (specifier === "next/headers") return { url: asDataUrl(HEADERS_DOUBLE), shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/features/sperrliste/mutations.ts")) return { format: "module", source: MUTATIONS_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/mail.ts")) return { format: "module", source: MAIL_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/auth.ts")) return { format: "module", source: AUTH_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGING_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

/** The bound the WRITE answers. Deliberately not the five-season arithmetic's, so a mail stating it could have come from nowhere else. */
const ANSWERED_BOUND = "2044";

const events: string[] = [];
const sent: { to: string; subject: string; html: string; text: string }[] = [];
const posted: { email: string; grund: string }[] = [];

const globals = globalThis as unknown as Record<string, unknown>;
globals[EVENTS] = events;
globals[SENT] = sent;
globals[POSTED] = posted;
globals[SEND_FAILS] = false;
globals[ANSWER] = { acknowledged: 1, created_id: "6890a1b2c3d4e5f607190001", gesperrt_bis_saison_id: ANSWERED_BOUND };

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

/* The removal alone, and the last declaration in the file: a search over the whole source is
   satisfied by the create, which does carry a mapper. */
const REMOVE_ACTION = sliceBetween(ACTIONS, "export async function deleteSperreAction", null);

const CREATE_OPERATION = "POST /sperrliste";

describe("the address a unique index already holds", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/shared/testing/sourceText.ts :: sliceBetween`). */
  it("cuts the removal out of the file before reading it", () => {
    assert.ok(REMOVE_ACTION.includes("deleteSperre(validated.data)"), "the removal's call is outside its slice");
  });
});

const { postSperreAction } = await import("./actions.ts");
const { SPERRE_ERFOLG } = await import("./constants.ts");

const BARRED = "zorbanax@beispielschule.de";
const GRUND = "Falsches Geburtsdatum angegeben";

const anAddressIsBanned = () => postSperreAction({ email: BARRED, grund: GRUND });

describe("the create's refusals", () => {
  beforeEach(() => {
    sent.length = 0;
    globals[SEND_FAILS] = false;
  });

  /* The create is the one write that sends an address, so it is the one that answers through the
     mapper; what the mapper answers is asked of it in `fl_frontend/src/features/sperrliste/refusals.test.ts`. */
  it("answers every refusal the create publishes through the mapper, and tells nobody", async () => {
    await assertEachAnswered({
      operation: CREATE_OPERATION,
      codes: publishedRefusals(CREATE_OPERATION),
      refuseWith: (next) => {
        globals[ANSWER] = next;
      },
      act: anAddressIsBanned,
      mapped: mapAdresseRefusal,
    });
    assert.deepEqual(sent, [], "a refused ban mailed the address it refused");
  });
});

describe("the message the barred person is sent", () => {
  beforeEach(() => {
    events.length = 0;
    sent.length = 0;
    posted.length = 0;
    globals[SEND_FAILS] = false;
    globals[ANSWER] = { acknowledged: 1, created_id: "6890a1b2c3d4e5f607190001", gesperrt_bis_saison_id: ANSWERED_BOUND };
  });

  it("sends the notice only after the write has been acknowledged", async () => {
    const result = await anAddressIsBanned();

    assert.equal(result.success, true);
    assert.deepEqual(events, ["post", "mail", "refresh"]);
  });

  /* The half the order alone cannot show: a send placed after the call but before its answer is
     read would tell somebody they are barred by a write that did not take. */
  it("tells nobody where the write was not acknowledged", async () => {
    globals[ANSWER] = { acknowledged: 0, created_id: "6890a1b2c3d4e5f607190001", gesperrt_bis_saison_id: ANSWERED_BOUND };

    const result = await anAddressIsBanned();

    assert.equal(result.success, false);
    assert.deepEqual(events, ["post"]);
  });

  /* The typed address is used for this one send and stored nowhere, so it reaches the mail module
     from the parsed payload and from no read of the row the write created. */
  it("mails the address that was typed, and the bound the write itself answered", async () => {
    await anAddressIsBanned();

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.to, BARRED);
    assert.deepEqual(posted, [{ email: BARRED, grund: GRUND }]);
    // The write's own answer and not the arithmetic's: `ANSWERED_BOUND` is a season no reference
    // season in this file composes, so a second read could not have produced it.
    assert.match(String(sent[0]?.text), new RegExp(`bis einschließlich der Saison ${ANSWERED_BOUND}`));
    assert.match(String(sent[0]?.text), new RegExp(GRUND));
  });

  /* The ban is already written and no address survives to re-send to, so a failure is reported
     rather than repaired -- and an administrator told nothing would assume the person knows. */
  it("leaves the ban standing on a failed send and says the person was not told", async () => {
    globals[SEND_FAILS] = true;

    const result = await anAddressIsBanned();

    assert.equal(result.success, true);
    // The list is still refreshed and nothing is removed: the row stands, and only the sentence
    // the administrator reads differs.
    assert.deepEqual(events, ["post", "mail", "refresh"]);
    assert.notEqual("message" in result ? result.message : undefined, SPERRE_ERFOLG);
    assert.match(String("message" in result ? result.message : ""), /nicht zugestellt/);
  });

  /* `EntityForm` shows the action's message as a description only where it DIFFERS from the title
     the form passes, so the success sentence and that literal are one string or every clean save
     grows a second line saying the same thing. */
  it("answers a clean save the exact title the form raises", async () => {
    const result = await anAddressIsBanned();

    assert.equal("message" in result ? result.message : undefined, SPERRE_ERFOLG);
    assert.ok(
      readFileSync(path.resolve(import.meta.dirname, "components", "forms", "AdminCreateSperreForm.tsx"), "utf8").includes(
        `successMessage="${SPERRE_ERFOLG}"`,
      ),
      "the form raises a title the action never answers, so a clean save shows it twice",
    );
  });
});

describe("the ban list's removal", () => {
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
