// @vitest-environment jsdom
import { Activity } from "react";
// The class Next's client throws for an action its server does not recognise.
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { redirect } from "next/navigation";

import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy/shared";
import { SERVER_COPY } from "@/core/serverCopy";
import { underNext } from "@/test-support/nextContexts";
import { thrownRedirect } from "@/test-support/thrownRedirect";

import { EDGE_REFUSAL_BODY } from "./edgeRefusal";
import { HeldForm } from "./HeldForm";
import { answering, statusOf, useFormAction } from "./useFormAction";

import type { ActionAnswer } from "@/core/action";
import type { ReactNode } from "react";
import type { FormStatus } from "./useFormAction";

// A press before hydration is the browser's own: without React's holding action, a GET with every field in the URL,
// which nothing on the page shows until a person reads the address bar or a log keeps the query. Every server-drawn form
// of the kit's is `HeldForm`, which the lint holds: it bans a raw `form` in the kit and imports React Aria's `Form` only
// into `HeldForm`.
describe("a form a visitor reaches before hydration", () => {
  it("hands its press to React, never the browser", () => {
    const held = document.createElement("div");
    held.innerHTML = renderToString(
      <HeldForm
        fieldErrors={undefined}
        isBusy={false}
        onSend={() => undefined}
      />,
    );
    expect(held.querySelector("form")?.getAttribute("action")).toMatch(/^javascript:/);
  });
});

describe("a form's action through the one wrapper", () => {
  // The harm: a refresh the frontend cannot answer becomes a document load, and the edge's error page replaces the form
  // with every typed answer, which nobody sees between outages.
  it.each<[string, Error]>([
    // Next's own wording for an answer that is not its own, such as the edge's 502 page.
    ["the edge's error page", new Error("An unexpected response was received from the server.")],
    ["a failed fetch", new TypeError("Failed to fetch")],
  ])("answers %s, which no answer of the frontend's carried, as the unexpected failure, reading nothing again", async (_case, error) => {
    const refresh = vi.fn();
    const answered = answering(async () => {
      throw error;
    }, refresh);
    expect(await answered(undefined)).toStrictEqual({ ok: false, reason: COPY.shared.failure.unexpected });
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each<[string, Error]>([
    ["an action that threw on the server", Object.assign(new Error("An error occurred in the Server Components render."), { digest: "1234" })],
    ["an action a newer build no longer serves", new UnrecognizedActionError('Server Action "0" was not found on the server.')],
  ])("answers %s with the stale-page line and reads the page again, since the frontend answered", async (_case, error) => {
    const refresh = vi.fn();
    const answered = answering(async () => {
      throw error;
    }, refresh);
    expect(await answered(undefined)).toStrictEqual({ ok: false, reason: COPY.shared.failure.stale });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("answers the edge's rate refusal with its own reason, reading nothing again", async () => {
    const refresh = vi.fn();
    // Next hands a rejected action the edge's plain-text body as its error's message.
    const answered = answering(async () => {
      throw new Error(EDGE_REFUSAL_BODY);
    }, refresh);
    expect(await answered(undefined)).toStrictEqual({ ok: false, reason: COPY.shared.failure.tooManyAttempts });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("lets Next's redirect through to Next", async () => {
    const answered = answering(async (): Promise<ActionAnswer> => redirect("/area"), vi.fn());
    expect((await thrownRedirect(answered(undefined))).address).toBe("/area");
  });
});

describe("a form's status line", () => {
  // The harm: an act that partly happened, such as an erasure whose sign-in account stands, read as a refusal to press
  // again; and a done act said on a form's line beside its toast, or on a form whose press only asked its question.
  it.each<[string, ActionAnswer, FormStatus]>([
    ["done", { ok: true, value: undefined, note: COPY.shared.addressChange.previousStays, warn: true }, null],
    ["refused", { ok: false, reason: COPY.shared.failure.stale }, { tone: "danger", text: COPY.shared.failure.stale }],
    ["partly refused", { ok: false, reason: COPY.shared.failure.stale, warn: true }, { tone: "warn", text: COPY.shared.failure.stale }],
  ])("gives a %s act its line in its own tone, or none", (_case, answer, line) => {
    expect(statusOf(answer, false, false)).toStrictEqual(line);
  });

  // A boxed refusal and a sentence in one answer: the sentence is said nowhere else, so the line says it.
  it("says a reason no box says, beside the boxes that say theirs", () => {
    const postcode = COPY.shared.field.required;
    const reason = SERVER_COPY.ruleLine.elfmeterschiessen_without_winner;
    expect(statusOf({ ok: false, fieldErrors: { postcode }, reason }, false, false)).toStrictEqual({ tone: "danger", text: reason });
  });
});

/** The hook under Next's `Activity`, which hides a page the person left and shows it again on return. */
function onAPage(resetOnLeave: boolean) {
  let mode: "visible" | "hidden" = "visible";
  // The hook reads the page again through Next's router, which the page stands under.
  const wrapper = ({ children }: { children: ReactNode }) => underNext(<Activity mode={mode}>{children}</Activity>);
  const view = renderHook(() => useFormAction(async (): Promise<ActionAnswer> => ({ ok: true, value: undefined }), { resetOnLeave }), {
    wrapper,
  });
  const leaveAndReturn = async () => {
    mode = "hidden";
    await act(async () => view.rerender());
    mode = "visible";
    await act(async () => view.rerender());
  };
  return { ...view, leaveAndReturn };
}

describe("an answer once the page is left", () => {
  it("stays where the answer replaced the form", async () => {
    const { result, leaveAndReturn } = onAPage(false);

    await act(async () => result.current.submit(undefined));
    await leaveAndReturn();
    expect(result.current.answer).toStrictEqual({ ok: true, value: undefined });
  });
});
