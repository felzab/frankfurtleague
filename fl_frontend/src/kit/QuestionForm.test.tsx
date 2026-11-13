// @vitest-environment jsdom
import { Activity } from "react";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { QuestionForm } from "./QuestionForm";
import { TextField } from "./TextField";
import { toastAnswer } from "./Toast";

import type { ActionAnswer } from "@/core/action";
import type { AskedInput } from "./QuestionForm";
import type * as ToastModule from "./Toast";

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
// Read off the call rather than the region: the toast queue is the module's own, and a toast outlives its test.
vi.mock("./Toast", async (original) => {
  const toast = await original<typeof ToastModule>();
  return { ...toast, toastAnswer: vi.fn(toast.toastAnswer) };
});

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

/** The form typed and pressed. */
async function press() {
  render(FORM);
  await userEvent.type(box(), ADDRESS);
  await userEvent.click(screen.getByRole("button", { name: VERB }));
}

beforeEach(() => {
  acts.read.mockReset();
  acts.act.mockReset();
  acts.touch.mockReset();
  vi.mocked(toastAnswer).mockClear();
  acts.read.mockResolvedValue(READ);
  acts.touch.mockResolvedValue({ data: { status: true, email: HOLDER }, error: null });
});

describe("a form asking its question over what the press read", () => {
  it("answers a refused read in its line, asking nothing and touching nothing", async () => {
    acts.read.mockResolvedValue({ ok: false, reason: COPY.shared.failure.stale });
    await press();

    expect(await screen.findByText(COPY.shared.failure.stale)).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(acts.touch).not.toHaveBeenCalled();
  });

  // The harm: the touch ahead of the question, the act sending what the boxes hold rather than what the read held, or
  // the done act said twice, in the line and in a toast.
  it("runs the act behind the touch on the read's input, emptying the boxes under its done line alone", async () => {
    acts.act.mockResolvedValue({ ok: true, value: undefined, note: COPY.admin.erased });
    await press();

    const question = await screen.findByRole("alertdialog");
    expect(within(question).getByText(SENTENCE)).toBeTruthy();
    expect(acts.touch).not.toHaveBeenCalled();
    await userEvent.click(within(question).getByRole("button", { name: VERB }));

    expect(await screen.findByText(COPY.admin.erased)).toBeTruthy();
    expect(acts.touch).toHaveBeenCalledOnce();
    expect(acts.act).toHaveBeenCalledWith({ email: ADDRESS, holder: HOLDER });
    await waitFor(() => {
      expect(box().value).toBe("");
    });
    expect(vi.mocked(toastAnswer)).not.toHaveBeenCalled();
  });

  // The harm: an erasure's done line greeting a later visit, or standing over the next address typed.
  it("clears a done act's line as the next address is typed and once the page hides", async () => {
    acts.act.mockResolvedValue({ ok: true, value: undefined, note: COPY.admin.erased });
    const { rerender } = render(<Activity mode="visible">{FORM}</Activity>);
    await userEvent.type(box(), ADDRESS);
    await userEvent.click(screen.getByRole("button", { name: VERB }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: VERB }));
    await screen.findByText(COPY.admin.erased);

    await userEvent.type(box(), ADDRESS);
    expect(screen.queryByText(COPY.admin.erased)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: VERB }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: VERB }));
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

    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: VERB }));
    await waitFor(() => {
      expect(vi.mocked(toastAnswer)).toHaveBeenLastCalledWith({ ok: false, reason: COPY.admin.erasure.partial }, COPY.shared.toast.done.delete);
    });
    expect([screen.queryByRole("alertdialog"), box().value]).toStrictEqual([null, ADDRESS]);

    await userEvent.click(screen.getByRole("button", { name: VERB }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: VERB }));
    await waitFor(() => {
      expect(acts.act).toHaveBeenCalledTimes(2);
    });
  });
});
