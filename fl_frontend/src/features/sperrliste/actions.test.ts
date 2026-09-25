import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActionRequest, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { doubleSendMail } from "@/shared/testing/mailDouble.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { assertEachAnswered, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { toActionErrorResult } from "@/shared/utils/actionError.ts";

import { mapAdresseRefusal } from "./refusals.ts";
import { FLPostSperrlistePayloadSchema } from "./schemas.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";
import type { MailOutcome } from "@/shared/testing/mailDouble.ts";

/* The ORDER between the write and the send decides whether somebody is told they are barred by a
   request that then failed, and no render shows it (`docs/frontend/spec.md` §1.9). Each double
   appends to one list, read instead of the source. */
const events: string[] = [];
const EVENTS = "__flSperreEvents";
(globalThis as unknown as Record<string, unknown>)[EVENTS] = events;

/* `refresh()` throws outside a request Next itself is rendering, and what a case here asks of it is
   that the action reached it at all. */
const CACHE_DOUBLE = `export const refresh = () => { globalThis.${EVENTS}.push("refresh"); };`;
const CONFIG_DOUBLE = `export const frontend_config = { AUTH_URL: "http://localhost:3000", LOG_LEVEL: "ERROR", LOG_FORMAT: "json" };`;

/* The real actions, their mutations and the mailer's callers, called: the request they run in, the
   backend client and the mailer are the doubles. */
doubleActionRequest();

// Registered after the request's doubles, so its `next/cache` answers before theirs.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/cache") return { url: `data:text/javascript,${encodeURIComponent(CACHE_DOUBLE)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

/** The bound the WRITE answers. Deliberately not the five-season arithmetic's, so a mail stating it could have come from nowhere else. */
const ANSWERED_BOUND = "2044";
const SPERRE_ID = "6890a1b2c3d4e5f607190001";

/** The create's answer as the backend sends it, acknowledged or not. */
const banned = (acknowledged: 0 | 1) => ({ acknowledged, created_id: SPERRE_ID, gesperrt_bis_saison_id: ANSWERED_BOUND });

const client = doubleApiAnswers(({ method }) => {
  events.push(method === "DELETE" ? "delete" : "post");
  return Promise.resolve(method === "DELETE" ? { acknowledged: 1, sperrliste_id: SPERRE_ID } : banned(1));
});
/** Answers each write with `next`, the event list recording which write it was first. */
const answerWith = (next: () => Promise<unknown>): void =>
  client.answerWith(({ method }: ApiCall) => {
    events.push(method === "DELETE" ? "delete" : "post");
    return next();
  });

const mail = doubleSendMail();
/** Ends the notice with `outcome`, the event list recording the send first. */
const sendWith = (outcome: MailOutcome): void =>
  mail.answerWith(() => {
    events.push("mail");
    return outcome;
  });

beforeEach(() => {
  events.length = 0;
  sendWith("accepted");
});

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step as it evaluates (`docs/frontend/spec.md` §1.9). */
const { AdminCreateSperreForm } = await import("./components/forms/AdminCreateSperreForm.tsx");

const CREATE_OPERATION = "POST /sperrliste";

const { deleteSperreAction, postSperreAction } = await import("./actions.ts");
const { SPERRE_ERFOLG } = await import("./constants.ts");

const BARRED = "zorbanax@beispielschule.de";
const GRUND = "Falsches Geburtsdatum angegeben";

const anAddressIsBanned = () => postSperreAction({ email: BARRED, grund: GRUND });

describe("the create's refusals", () => {
  /* The create is the one write that sends an address, so it is the one that answers through the
     mapper; what the mapper answers is asked of it in `fl_frontend/src/features/sperrliste/refusals.test.ts`. */
  it("answers every refusal the create publishes through the mapper, and tells nobody", async () => {
    await assertEachAnswered({
      operation: CREATE_OPERATION,
      refuseWith: answerWith,
      act: anAddressIsBanned,
      mapped: mapAdresseRefusal,
    });
    assert.deepEqual(mail.sent, [], "a refused ban mailed the address it refused");
  });
});

describe("the message the barred person is sent", () => {
  it("sends the notice only after the write has been acknowledged", async () => {
    const result = await anAddressIsBanned();

    assert.equal(result.success, true);
    assert.deepEqual(events, ["post", "mail", "refresh"]);
  });

  /* The half the order alone cannot show: a send placed after the call but before its answer is
     read would tell somebody they are barred by a write that did not take. */
  it("tells nobody where the write was not acknowledged", async () => {
    answerWith(() => Promise.resolve(banned(0)));

    const result = await anAddressIsBanned();

    assert.equal(result.success, false);
    assert.deepEqual(events, ["post"]);
  });

  /* The typed address is used for this one send and stored nowhere, so it reaches the mail module
     from the parsed payload and from no read of the row the write created. */
  it("mails the address that was typed, and the bound the write itself answered", async () => {
    await anAddressIsBanned();

    assert.equal(mail.sent.length, 1);
    assert.equal(mail.sent[0]?.to, BARRED);
    assert.deepEqual(
      requestsOf(client.calls).map(({ body }) => body),
      [{ email: BARRED, grund: GRUND }],
    );
    // The write's own answer and not the arithmetic's: `ANSWERED_BOUND` is a season no reference
    // season in this file composes, so a second read could not have produced it.
    assert.match(String(mail.sent[0]?.text), new RegExp(`bis einschließlich der Saison ${ANSWERED_BOUND}`));
    assert.match(String(mail.sent[0]?.text), new RegExp(GRUND));
  });

  /* The ban is already written and no address survives to re-send to, so a failure is reported
     rather than repaired -- and an administrator told nothing would assume the person knows. */
  it("leaves the ban standing on a failed send and says the person was not told", async () => {
    sendWith("refused");

    const result = await anAddressIsBanned();

    assert.equal(result.success, true);
    // The list is still refreshed and nothing is removed: the row stands, and only the sentence
    // the administrator reads differs.
    assert.deepEqual(events, ["post", "mail", "refresh"]);
    assert.notEqual("message" in result ? result.message : undefined, SPERRE_ERFOLG);
    assert.match(String("message" in result ? result.message : ""), /nicht zugestellt/);
  });

  /* A connection broken after the send left may be a message the provider accepted: saying the person
     was not told would be a guess, as it would in a fan-out. */
  it("answers a notice whose connection broke off as of unknown outcome", async () => {
    sendWith("lost");

    const result = await anAddressIsBanned();

    assert.equal("outcome" in result ? result.outcome : undefined, "unknown");
    assert.deepEqual(events, ["post", "mail", "refresh"], "the ban's page was left standing");
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
    const { unmount } = render(underNext(h(AdminCreateSperreForm, { onClose: () => undefined })));
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
  /* A removal whose row another administrator has already lifted answers 404, which
     `fl_frontend/src/shared/utils/actionError.ts` already words as the reload it is. */
  it("answers a row already lifted in the shared reader's words", async () => {
    const lifted = refusedOn("DELETE /sperrliste/{sperrliste_id}", "DB-COMMON-001", 404);
    answerWith(() => Promise.reject(lifted));

    const result = await deleteSperreAction({ id: SPERRE_ID });

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
