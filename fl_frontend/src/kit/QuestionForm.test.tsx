// @vitest-environment jsdom
import { Activity } from "react";

import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACCOUNT_COPY } from "@/core/copy/account";
import { COPY } from "@/core/copy/shared";
import { renderUnderNext } from "@/test-support/nextContexts";

import { QuestionForm } from "./QuestionForm";
import { TextField } from "./TextField";
import { ToastRegion } from "./Toast";

import type { ActionAnswer } from "@/core/action";
import type { AskedInput } from "./QuestionForm";

type Input = { email: string };

const ADDRESS = "max@example.org";
const HOLDER = "pia@example.org";
const VERB = COPY.shared.verb.delete;
const SENTENCE = ACCOUNT_COPY.erasure.consequence;
const READ: ActionAnswer<AskedInput<Input>> = {
  ok: true,
  value: { question: { subject: COPY.template.account, consequence: SENTENCE }, input: { email: ADDRESS } },
};

const acts = vi.hoisted(() => ({ read: vi.fn(), run: vi.fn(), touch: vi.fn() }));

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
    run={acts.run}
    holder={HOLDER}>
    <TextField
      label={COPY.shared.emailAddress}
      name="email"
      kind="email"
    />
  </QuestionForm>
);

/** The question the press opens, by its name: a toast is an alert dialog too. */
const QUESTION = COPY.shared.question(COPY.template.account, "delete");

/** The form typed and pressed, the frame's toast region beside it. */
async function press() {
  renderUnderNext(
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
  acts.run.mockReset();
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
    acts.run.mockResolvedValue({ ok: true, value: undefined, note: COPY.shared.state.erased });
    await press();

    const question = await screen.findByRole("alertdialog", { name: QUESTION });
    expect(within(question).getByText(SENTENCE)).toBeTruthy();
    expect(acts.touch).not.toHaveBeenCalled();
    await userEvent.click(within(question).getByRole("button", { name: VERB }));

    expect(await screen.findByText(COPY.shared.state.erased)).toBeTruthy();
    expect(acts.touch).toHaveBeenCalledOnce();
    expect(acts.run).toHaveBeenCalledWith({ email: ADDRESS, holder: HOLDER });
    await waitFor(() => {
      expect(box().value).toBe("");
    });
    // The line alone, the question closed: a toast, in any words, would say the act a second time.
    expect([screen.getAllByText(COPY.shared.state.erased).length, screen.queryAllByRole("alertdialog")]).toStrictEqual([1, []]);
  });

  // The harm: an erasure's done line greeting a later visit, or standing over the next address typed.
  it("clears a done act's line as the next address is typed and once the page hides", async () => {
    acts.run.mockResolvedValue({ ok: true, value: undefined, note: COPY.shared.state.erased });
    const { rerender } = renderUnderNext(<Activity mode="visible">{FORM}</Activity>);
    await userEvent.type(box(), ADDRESS);
    await userEvent.click(screen.getByRole("button", { name: VERB }));
    await userEvent.click(within(await screen.findByRole("alertdialog", { name: QUESTION })).getByRole("button", { name: VERB }));
    await screen.findByText(COPY.shared.state.erased);

    await userEvent.type(box(), ADDRESS);
    expect(screen.queryByText(COPY.shared.state.erased)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: VERB }));
    await userEvent.click(within(await screen.findByRole("alertdialog", { name: QUESTION })).getByRole("button", { name: VERB }));
    await screen.findByText(COPY.shared.state.erased);

    rerender(<Activity mode="hidden">{FORM}</Activity>);
    rerender(<Activity mode="visible">{FORM}</Activity>);
    await waitFor(() => {
      expect(screen.queryByText(COPY.shared.state.erased)).toBeNull();
    });
  });

  // The harm: a passkey touch asked for an act off its fixed list, such as a withdrawal entered from a mail.
  it("runs an act off the touch's list inside its question, asking no touch", async () => {
    acts.run.mockResolvedValue({ ok: true, value: undefined, note: COPY.shared.state.erased });
    renderUnderNext(
      <QuestionForm
        verb="delete"
        tone="danger"
        touch={false}
        read={acts.read}
        run={acts.run}
        holder={HOLDER}>
        <TextField
          label={COPY.shared.emailAddress}
          name="email"
          kind="email"
        />
      </QuestionForm>,
    );
    await userEvent.type(box(), ADDRESS);
    await userEvent.click(screen.getByRole("button", { name: VERB }));
    await userEvent.click(within(await screen.findByRole("alertdialog", { name: QUESTION })).getByRole("button", { name: VERB }));

    expect(await screen.findByText(COPY.shared.state.erased)).toBeTruthy();
    expect(acts.run).toHaveBeenCalledWith({ email: ADDRESS, holder: HOLDER });
    expect(acts.touch).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryAllByRole("alertdialog")).toStrictEqual([]);
    });
  });

  // The harm: a refused erasure's address gone, so the repeat that reaches the account left standing is typed anew.
  it("toasts an act's refusal, its boxes kept, and the form's press runs the act again", async () => {
    acts.run.mockResolvedValue({ ok: false, reason: COPY.shared.failure.stale });
    await press();

    await userEvent.click(within(await screen.findByRole("alertdialog", { name: QUESTION })).getByRole("button", { name: VERB }));
    const toast = await screen.findByRole("alertdialog", { name: COPY.shared.failure.stale });
    expect(toast.querySelector(".text-danger")).toBeTruthy();
    expect([screen.queryByRole("alertdialog", { name: QUESTION }), box().value]).toStrictEqual([null, ADDRESS]);

    // The toast stands as the act answers, ahead of the render ending the press's busy state, which a loaded machine
    // slices across tasks; React Aria takes no press on a busy button, so the next press waits for the one a person sees.
    const again = screen.getByRole("button", { name: VERB });
    await waitFor(() => {
      expect(again.hasAttribute("data-pending")).toBe(false);
    });
    await userEvent.click(again);
    await userEvent.click(within(await screen.findByRole("alertdialog", { name: QUESTION })).getByRole("button", { name: VERB }));
    await waitFor(() => {
      expect(acts.run).toHaveBeenCalledTimes(2);
    });
  });
});
