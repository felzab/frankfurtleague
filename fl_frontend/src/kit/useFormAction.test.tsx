// @vitest-environment jsdom
import { Activity } from "react";
import { redirect } from "next/navigation";

import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import { AccountBox } from "./AccountBox";
import { EDGE_REFUSAL_BODY } from "./edgeRefusal";
import { EditorPage } from "./EditorPage";
import { OneShotForm } from "./OneShot";
import { SignInPage } from "./SignInPage";
import { StepCard } from "./StepCard";
import { TextField } from "./TextField";
import { useEditor } from "./useEditor";
import { answering, statusOf, useFormAction } from "./useFormAction";

import type { ActionAnswer } from "@/core/action";
import type { ReactElement, ReactNode } from "react";

// The hook reads the page again through Next's router, which no test mounts.
vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), useRouter: () => ({ refresh: () => {} }) }));

const WORDS = COPY.signIn;
const refused = async () => ({ ok: false, reason: COPY.shared.failure.stale }) as const;

/** An editor of one text box, which Enter submits with no submit button on the form. */
function HeldEditor() {
  const editor = useEditor({ id: "ort-1", version: 1, values: { name: "Riedberg" } }, refused);
  return (
    <EditorPage
      title={{ record: "Riedberg" }}
      editor={editor}
      sections={[
        {
          id: "ort",
          title: WORDS.address,
          fields: (
            <TextField
              label={WORDS.address}
              name="name"
              kind="text"
              value={editor.draft.name}
            />
          ),
        },
      ]}
    />
  );
}

// A press before hydration is the browser's own: without React's holding action, a GET with every field in the URL,
// which nothing on the page shows until a person reads the address bar or a log keeps the query.
describe("a form a visitor reaches before hydration", () => {
  it.each<[string, ReactElement]>([
    [
      "the sign-in's address",
      <SignInPage
        key="sign-in"
        view="address"
        title={WORDS.title}
        row={null}
        address={{ label: WORDS.address, value: "", onChange: () => undefined }}
        check={null}
        send={{ label: WORDS.sendCode, onPress: () => undefined }}
        or={WORDS.or}
        passkey={{ label: WORDS.withPasskey, onPress: () => undefined }}
      />,
    ],
    [
      "a Konto box",
      <AccountBox
        key="account"
        title={WORDS.address}
        description={COPY.account.address.description}
        act={{ run: refused, button: { label: WORDS.sendCode } }}
      />,
    ],
    [
      "a one-shot form",
      <OneShotForm
        key="one-shot"
        head={<p />}
        action={refused}
        acts={{ primary: WORDS.sendCode }}
      />,
    ],
    ["an editor", <HeldEditor key="editor" />],
    [
      "a run's card",
      <StepCard
        key="step"
        title={WORDS.title}
        line={WORDS.title}
        facts={[]}
        onNext={() => undefined}
        onSkip={() => undefined}>
        <p />
      </StepCard>,
    ],
  ])("hands %s to React, never the browser", (_, form) => {
    const held = document.createElement("div");
    held.innerHTML = renderToString(form);
    expect(held.querySelector("form")?.getAttribute("action")).toMatch(/^javascript:/);
  });
});

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

describe("a form's status line for a refusal", () => {
  it("points at the fields rather than repeat a reason they already carry", () => {
    const postcode = COPY.shared.field.required;
    expect(statusOf({ ok: false, fieldErrors: { postcode }, reason: postcode }, false, false)).toStrictEqual({
      tone: "error",
      text: COPY.template.checkFields,
    });
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
