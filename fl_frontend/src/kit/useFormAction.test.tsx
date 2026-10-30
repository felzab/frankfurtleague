// @vitest-environment jsdom
import { Activity } from "react";
import { redirect } from "next/navigation";

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { EDGE_REFUSAL_BODY } from "@/shared/utils/actionError";

import { answering, statusOf, useFormAction } from "./useFormAction";

import type { ActionAnswer } from "@/core/action";
import type { ReactNode } from "react";

// The hook reads the page again through Next's router, which no test mounts.
vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), useRouter: () => ({ refresh: () => {} }) }));

describe("a form's action through the one wrapper", () => {
  it("answers as the action answered", async () => {
    const answer: ActionAnswer<string> = { ok: true, value: "ort-1" };
    const refresh = vi.fn();
    expect(await answering(async () => answer, refresh)(undefined)).toStrictEqual(answer);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("answers any throw with the stale-page line and reads the page again, since the press may have written before its answer was lost", async () => {
    const refresh = vi.fn();
    const answered = answering(async () => {
      throw new Error("An unexpected response was received from the server.");
    }, refresh);
    expect(await answered(undefined)).toStrictEqual({ ok: false, reason: COPY.shared.fehler.veraltet });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("answers the edge's rate refusal with its own reason, reading nothing again", async () => {
    const refresh = vi.fn();
    // Next hands a rejected action the edge's plain-text body as its error's message.
    const answered = answering(async () => {
      throw new Error(EDGE_REFUSAL_BODY);
    }, refresh);
    expect(await answered(undefined)).toStrictEqual({ ok: false, reason: COPY.shared.fehler.zuVieleVersuche });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("lets Next's redirect through to Next", async () => {
    const answered = answering(async (): Promise<ActionAnswer> => redirect("/bereich"), vi.fn());
    await expect(answered(undefined)).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });
});

describe("a form's status line for a refusal", () => {
  it("points at the fields rather than repeat a reason they already carry", () => {
    const plz = COPY.shared.feld.pflichtfeld;
    expect(statusOf({ ok: false, fieldErrors: { plz }, reason: plz }, false, false)).toStrictEqual({
      tone: "error",
      text: COPY.vorlage.felderPruefen,
    });
  });

  it("says nothing while the next send is on its way, so the same refusal again is announced again", () => {
    expect(statusOf({ ok: false, reason: COPY.shared.fehler.zuVieleVersuche }, false, true)).toBeNull();
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
