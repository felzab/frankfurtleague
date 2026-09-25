import "@/shared/testing/dom.ts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActionRequest, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { answer, answerReadsWith, EMPTIEST_ANSWER, OBJECT_ID, renderPage } from "@/shared/testing/pageHarness.ts";
import { assertEachAnswered, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";
import { toActionErrorResult } from "@/shared/utils/actionError.ts";

import { mapAdresseRefusal } from "./refusals.ts";
import { FLPostSperrlistePayloadSchema } from "./schemas.ts";

import type { ReactElement } from "react";

const EVENTS = "__flSperreEvents";
const SENT = "__flSperreSentMail";
const POSTED = "__flSperrePosted";
const ANSWER = "__flSperrePostAnswer";
const SEND_FAILS = "__flSperreSendFails";
const DELETE_REFUSAL = "__flSperreDeleteRefusal";

const asDataUrl = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

/* The ORDER between the write and the send decides whether somebody is told they are barred by a
   request that then failed, and no render shows it (`docs/frontend/spec.md` §1.9). Each double
   appends to one list, read instead of the source. */
const MUTATIONS_DOUBLE = `import { recordWriteSent } from "@/core/requestScope";
export const postSperre = async (payload) => {
  recordWriteSent();
  globalThis.${EVENTS}.push("post");
  globalThis.${POSTED}.push(payload);
  const answer = globalThis.${ANSWER};
  return typeof answer === "function" ? answer() : answer;
};
export const deleteSperre = async () => {
  recordWriteSent();
  globalThis.${EVENTS}.push("delete");
  const refusal = globalThis.${DELETE_REFUSAL};
  if (refusal !== undefined) throw refusal;
  return { acknowledged: 1, sperrliste_id: "6890a1b2c3d4e5f607190001" };
};`;

// Both write doubles record their write as the clients they stand for do: the spine refreshes only after one.
const MAIL_DOUBLE = `import { recordWriteSent } from "@/core/requestScope";
export const sendMail = async (message) => {
  recordWriteSent();
  globalThis.${EVENTS}.push("mail");
  if (globalThis.${SEND_FAILS}) throw new Error("the provider refused the message");
  globalThis.${SENT}.push(message);
  return { id: null };
};`;

/* `refresh()` throws outside a request Next itself is rendering, and what a case here asks of it is
   that the action reached it at all. */
const CACHE_DOUBLE = `export const refresh = () => { globalThis.${EVENTS}.push("refresh"); };`;

const CONFIG_DOUBLE = `export const frontend_config = { AUTH_URL: "http://localhost:3000", LOG_LEVEL: "ERROR", LOG_FORMAT: "json" };`;

doubleActionRequest();

// Registered after the request's doubles, so its `next/cache` answers before theirs.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/cache") return { url: asDataUrl(CACHE_DOUBLE), shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/features/sperrliste/mutations.ts")) return { format: "module", source: MUTATIONS_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/mail.ts")) return { format: "module", source: MAIL_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

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

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step as it evaluates (`docs/frontend/spec.md` §1.9). */
const { default: AdminSperrlistePage } = await import("@/app/admin/sperrliste/page.tsx");
const { AdminCrudShell } = await import("@/shared/components/ui/AdminCrudShell.tsx");
const { AdminCreateSperreForm } = await import("./components/forms/AdminCreateSperreForm.tsx");

/** The one ban the list read answers, every other read the emptiest body its schema takes. */
const EINTRAG = {
  id: OBJECT_ID,
  grund: "Fremde Namen eingetragen",
  erstellt_von: "vorstand@example.org",
  erstellt_am: "2026-03-01",
  gesperrt_bis_saison_id: "2030",
};
answerReadsWith((endpoint, schema, params) =>
  endpoint === "/sperrliste"
    ? answer(schema, endpoint, { sperrliste: [EINTRAG], anzahl_gesamt: 1 })
    : EMPTIEST_ANSWER(endpoint, schema, params),
);

/** The page at its own address. */
const PAGE = underNext(h(AdminSperrlistePage, {}), { pathname: "/admin/sperrliste" });

const CREATE_OPERATION = "POST /sperrliste";

const { deleteSperreAction, postSperreAction } = await import("./actions.ts");
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

    // The form over this same action, pressed as an administrator presses it.
    toasts.length = 0;
    const user = userEvent.setup();
    const { unmount } = render(h(AdminCreateSperreForm, { onClose: () => undefined }));
    await user.type(screen.getByRole("textbox", { name: /E-Mail/ }), BARRED);
    await user.type(screen.getByRole("textbox", { name: /Grund/ }), GRUND);
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    // The write runs inside a transition, so the press returns before its toast is raised.
    await waitFor(() => {
      assert.ok(toasts.length > 0, "the save raised no toast at all");
    });
    unmount();

    assert.deepEqual(
      toasts.map(({ variant, title, description }) => [variant, title, description]),
      [["success", SPERRE_ERFOLG, undefined]],
      "the form raises a title the action never answers, so a clean save shows it twice",
    );
  });
});

describe("the ban list's removal", () => {
  afterEach(() => {
    globals[DELETE_REFUSAL] = undefined;
  });

  /* A removal whose row another administrator has already lifted answers 404, which
     `fl_frontend/src/shared/utils/actionError.ts` already words as the reload it is. */
  it("answers a row already lifted in the shared reader's words", async () => {
    const lifted = refusedOn("DELETE /sperrliste/{sperrliste_id}", "DB-COMMON-001", 404);
    globals[DELETE_REFUSAL] = lifted;

    const result = await deleteSperreAction({ id: "6890a1b2c3d4e5f607190001" });

    assert.deepEqual(result, toActionErrorResult(lifted, { method: "POST", readOnly: false }));
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
  it("raises no heading the shell already owns", async () => {
    const markup = await renderPage(PAGE);

    // The control: a page rendering no row at all would satisfy the absence below unread.
    assert.ok(markup.includes(EINTRAG.grund), "the list renders no ban, so the absence below proves nothing");
    assert.ok(!markup.includes("<h1"), "the page raises an h1 the shell already owns");
  });

  /* The bar an administrator types into is the one control this page offers, and the query it takes
     is a person's address: on this route alone it is held in the page rather than written to `?q=`. */
  it("asks the shell to hold the typed query instead of writing it", () => {
    const shell = AdminSperrlistePage() as ReactElement<{ privateQuery?: boolean }>;

    // What the flag does is `fl_frontend/src/shared/components/ui/AdminCrudPrivateQuery.test.ts`'s to hold.
    assert.equal(shell.type, AdminCrudShell, "the page's chrome is no longer the shell the flag is read by");
    assert.equal(shell.props.privateQuery, true, "the bar writes the typed address into a request line nginx logs");
  });

  /* The page's chrome may never wait on the list: rendered with no boundary awaited, the bar stands
     beside the list's fallback, where an async page would suspend whole. */
  it("renders its chrome before the list resolves", () => {
    const markup = renderTree(PAGE);

    assert.ok(markup.includes('role="status"'), "no fallback stands where the list will resolve");
    assert.ok(markup.includes('type="search"'), "the page's bar waits on the list");
  });
});
