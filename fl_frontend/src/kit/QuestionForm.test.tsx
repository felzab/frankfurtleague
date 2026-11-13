// @vitest-environment jsdom
import { Activity } from "react";

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { QuestionForm } from "./QuestionForm";
import { TextField } from "./TextField";
import { ToastRegion } from "./Toast";

import type { ActionAnswer } from "@/core/action";
import type { AskedInput } from "./QuestionForm";

type Input = { email: string };

const ADDRESS = "max@example.org";
const HOLDER = "pia@example.org";
const VERB = COPY.shared.verb.delete;
const SENTENCE = COPY.admin.erasure.consequence;
const READ: ActionAnswer<AskedInput<Input>> = {
  ok: true,
  value: { question: { subject: COPY.admin.erasure.object, consequence: SENTENCE }, input: { email: ADDRESS } },
};

const acts = vi.hoisted(() => ({ read: vi.fn(), act: vi.fn(), touch: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/core/auth/browserClient", () => ({
  loadAuthClient: async () => ({ signIn: { passkey: acts.touch } }),
  usePreloadedAuthClient: () => undefined,
}));
const box = () => screen.getByRole<HTMLInputElement>("textbox");

const FORM = (
  <QuestionForm
    verb="delete"
    tone="danger"
    read={acts.read}
    act={acts.act}
    holder={HOLDER}>
    <TextField
      label={COPY.signIn.address}
      name="email"
      kind="email"
    />
  </QuestionForm>
);

/** The question the press opens, by its name: a toast is an alert dialog too. */
const QUESTION = COPY.shared.question(COPY.admin.erasure.object, "delete");

/** The form typed and pressed, the frame's toast region beside it. */
async function press() {
  render(
    <>
      {FORM}
      <ToastRegion frame="rail" />
    </>,
  );
  await userEvent.type(box(), ADDRESS);
  await userEvent.click(screen.getByRole("button", { name: VERB }));
}

beforeEach(() => {
  acts.read.mockReset();
  acts.act.mockReset();
  acts.touch.mockReset();
  acts.read.mockResolvedValue(READ);
  acts.touch.mockResolvedValue({ data: { status: true, email: HOLDER }, error: null });
});

// The toast queue is the module's own, so a toast outlives its case: each is closed while the case's region stands.
afterEach(() => {
  for (const close of screen.queryAllByRole("button", { name: COPY.shared.close })) act(() => close.click());
});

describe("a form asking its question over what the press read", () => {
  // The harm: the touch ahead of the question, the act sending what the boxes hold rather than what the read held, or
  // the done act said twice, in the line and in a toast.
  it("runs the act behind the touch on the read's input, emptying the boxes under its done line alone", async () => {
    acts.act.mockResolvedValue({ ok: true, value: undefined, note: COPY.admin.erased });
    await press();

    const question = await screen.findByRole("alertdialog", { name: QUESTION });
    expect(within(question).getByText(SENTENCE)).toBeTruthy();
    expect(acts.touch).not.toHaveBeenCalled();
    await userEvent.click(within(question).getByRole("button", { name: VERB }));

    expect(await screen.findByText(COPY.admin.erased)).toBeTruthy();
    expect(acts.touch).toHaveBeenCalledOnce();
    expect(acts.act).toHaveBeenCalledWith({ email: ADDRESS, holder: HOLDER });
    await waitFor(() => {
      expect(box().value).toBe("");
    });
    // The line alone: a toast would say it a second time.
    expect(screen.getAllByText(COPY.admin.erased)).toHaveLength(1);
  });

  // The harm: an erasure's done line greeting a later visit, or standing over the next address typed.
  it("clears a done act's line as the next address is typed and once the page hides", async () => {
    acts.act.mockResolvedValue({ ok: true, value: undefined, note: COPY.admin.erased });
    const { rerender } = render(<Activity mode="visible">{FORM}</Activity>);
    await userEvent.type(box(), ADDRESS);
    await userEvent.click(screen.getByRole("button", { name: VERB }));
    await userEvent.click(within(await screen.findByRole("alertdialog", { name: QUESTION })).getByRole("button", { name: VERB }));
    await screen.findByText(COPY.admin.erased);

    await userEvent.type(box(), ADDRESS);
    expect(screen.queryByText(COPY.admin.erased)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: VERB }));
    await userEvent.click(within(await screen.findByRole("alertdialog", { name: QUESTION })).getByRole("button", { name: VERB }));
    await screen.findByText(COPY.admin.erased);

    rerender(<Activity mode="hidden">{FORM}</Activity>);
    rerender(<Activity mode="visible">{FORM}</Activity>);
    await waitFor(() => {
      expect(screen.queryByText(COPY.admin.erased)).toBeNull();
    });
  });

  // The harm: a refused erasure's address gone, so the repeat that reaches the account left standing is typed anew.
  it("toasts an act's refusal, its boxes kept, and the form's press runs the act again", async () => {
    acts.act.mockResolvedValue({ ok: false, reason: COPY.admin.erasure.partial });
    await press();

    await userEvent.click(within(await screen.findByRole("alertdialog", { name: QUESTION })).getByRole("button", { name: VERB }));
    const toast = await screen.findByRole("alertdialog", { name: COPY.admin.erasure.partial });
    expect(toast.querySelector(".text-danger")).toBeTruthy();
    expect([screen.queryByRole("alertdialog", { name: QUESTION }), box().value]).toStrictEqual([null, ADDRESS]);

    await userEvent.click(screen.getByRole("button", { name: VERB }));
    await userEvent.click(within(await screen.findByRole("alertdialog", { name: QUESTION })).getByRole("button", { name: VERB }));
    await waitFor(() => {
      expect(acts.act).toHaveBeenCalledTimes(2);
    });
  });
});
