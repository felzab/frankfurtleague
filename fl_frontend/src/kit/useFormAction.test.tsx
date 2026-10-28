// @vitest-environment jsdom
import { Activity } from "react";
import { redirect } from "next/navigation";

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";
import { EDGE_REFUSAL_BODY } from "@/shared/utils/actionError";

import { answering, useFormAction } from "./useFormAction";

import type { ReactNode } from "react";
import type { ActionAnswer } from "./useFormAction";

describe("a form's action through the one wrapper", () => {
  it("answers as the action answered", async () => {
    const answer: ActionAnswer<string> = { ok: true, value: "ort-1" };
    expect(await answering(async () => answer)(undefined)).toStrictEqual(answer);
  });

  it("answers any throw with the stale-page line, since the press may have written before its answer was lost", async () => {
    const answered = answering(async () => {
      throw new Error("An unexpected response was received from the server.");
    });
    expect(await answered(undefined)).toStrictEqual({ ok: false, reason: COPY.shared.fehler.veraltet });
  });

  it("answers the edge's rate refusal with its own reason", async () => {
    // Next hands a rejected action the edge's plain-text body as its error's message.
    const answered = answering(async () => {
      throw new Error(EDGE_REFUSAL_BODY);
    });
    expect(await answered(undefined)).toStrictEqual({ ok: false, reason: COPY.shared.fehler.zuVieleVersuche });
  });

  it("lets Next's redirect through to Next", async () => {
    const answered = answering(async (): Promise<ActionAnswer> => redirect("/bereich"));
    await expect(answered(undefined)).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
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
