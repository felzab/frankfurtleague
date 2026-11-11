// @vitest-environment jsdom
import { Activity } from "react";
import { redirect } from "next/navigation";

import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import { EDGE_REFUSAL_BODY } from "./edgeRefusal";
import { HeldForm } from "./HeldForm";
import { answering, statusOf, useFormAction } from "./useFormAction";

import type { ActionAnswer } from "@/core/action";
import type { ReactNode } from "react";
import type { FormStatus } from "./useFormAction";

// The hook reads the page again through Next's router, which no test mounts.
vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), useRouter: () => ({ refresh: () => {} }) }));

// A press before hydration is the browser's own: without React's holding action, a GET with every field in the URL,
// which nothing on the page shows until a person reads the address bar or a log keeps the query. Every server-drawn form
// of the kit's is `HeldForm`, which the lint holds: it bans a raw `form` in the kit and imports React Aria's `Form` only
// into `HeldForm` and `Dialog`, whose form opens after hydration alone.
describe("a form a visitor reaches before hydration", () => {
  it("hands its press to React, never the browser", () => {
    const held = document.createElement("div");
    held.innerHTML = renderToString(<HeldForm onSend={() => undefined} />);
    expect(held.querySelector("form")?.getAttribute("action")).toMatch(/^javascript:/);
  });
});

describe("a form's action through the one wrapper", () => {
  it("answers any throw with the stale-page line and reads the page again, since the press may have written before its answer was lost", async () => {
    const refresh = vi.fn();
    const answered = answering(async () => {
      throw new Error("An unexpected response was received from the server.");
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
    await expect(answered(undefined)).rejects.toHaveProperty("digest", expect.stringContaining("NEXT_REDIRECT"));
  });
});

describe("a form's status line", () => {
  it("points at the fields rather than repeat a reason they already carry", () => {
    const postcode = COPY.shared.field.required;
    expect(statusOf({ ok: false, fieldErrors: { postcode }, reason: postcode }, false, false)).toStrictEqual({
      tone: "error",
      text: COPY.template.checkFields,
    });
  });

  // The harm: an act that partly happened, such as a ban whose mail went unsent, read as a clean save or as a refusal
  // to press again. `Dialog`, `AccountBox`, `OneShot`, `QuestionForm` and `SectionAct` each read their line here.
  it.each<[string, ActionAnswer, FormStatus]>([
    ["done", { ok: true, value: undefined }, { tone: "saved", text: COPY.shared.saved }],
    [
      "partly done",
      { ok: true, value: undefined, note: COPY.admin.banList.partial.notice, warn: true },
      { tone: "warn", text: COPY.admin.banList.partial.notice },
    ],
    ["refused", { ok: false, reason: COPY.shared.failure.stale }, { tone: "error", text: COPY.shared.failure.stale }],
    ["partly refused", { ok: false, reason: COPY.shared.failure.stale, warn: true }, { tone: "warn", text: COPY.shared.failure.stale }],
  ])("reads a %s act in its own tone", (_case, answer, line) => {
    expect(statusOf(answer, false, false)).toStrictEqual(line);
  });

  // A boxed refusal and a sentence in one answer: the sentence is said nowhere else, so the line says it.
  it("says a reason no box says, beside the boxes that say theirs", () => {
    const postcode = COPY.shared.field.required;
    const reason = SERVER_COPY.ruleLine.elfmeterschiessen_without_draw;
    expect(statusOf({ ok: false, fieldErrors: { postcode }, reason }, false, false)).toStrictEqual({ tone: "error", text: reason });
  });
});

/** The hook under Next's `Activity`, which hides a page the person left and shows it again on return. */
function onAPage(resetOnLeave: boolean) {
  let mode: "visible" | "hidden" = "visible";
  const wrapper = ({ children }: { children: ReactNode }) => <Activity mode={mode}>{children}</Activity>;
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
  it("is cleared where the form resets on leaving", async () => {
    const { result, leaveAndReturn } = onAPage(true);

    await act(async () => result.current.submit(undefined));
    expect(result.current.answer).toStrictEqual({ ok: true, value: undefined });

    await leaveAndReturn();
    expect(result.current.answer).toBeNull();
  });

  it("stays where the answer replaced the form", async () => {
    const { result, leaveAndReturn } = onAPage(false);

    await act(async () => result.current.submit(undefined));
    await leaveAndReturn();
    expect(result.current.answer).toStrictEqual({ ok: true, value: undefined });
  });
});
