// @vitest-environment jsdom
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
    rules={{}}
    verb="delete"
    tone="danger"
    read={acts.read}
    run={acts.run}
    touch={{ holder: HOLDER }}>
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
  // the done act said twice.
  it("runs the act behind the touch on the read's input, emptying the boxes and saying its note in one toast", async () => {
    acts.run.mockResolvedValue({ ok: true, value: undefined, note: COPY.shared.state.erased });
    await press();

    const question = await screen.findByRole("alertdialog", { name: QUESTION });
    expect(within(question).getByText(SENTENCE)).toBeTruthy();
    expect(acts.touch).not.toHaveBeenCalled();
    await userEvent.click(within(question).getByRole("button", { name: VERB }));

    expect((await screen.findByRole("alertdialog", { name: COPY.shared.state.erased })).querySelector(".text-success")).toBeTruthy();
    expect(acts.touch).toHaveBeenCalledOnce();
    expect(acts.run).toHaveBeenCalledWith({ email: ADDRESS, holder: HOLDER });
    await waitFor(() => {
      expect(box().value).toBe("");
    });
    // The toast alone, the question closed and the form's line empty: the line would say the act a second time.
    expect([screen.getAllByText(COPY.shared.state.erased).length, screen.getAllByRole("alertdialog").length]).toStrictEqual([1, 1]);
  });

  // The harm: a passkey touch asked for an act off its fixed list, such as a withdrawal entered from a mail.
  it("runs an act off the touch's list inside its question, asking no touch", async () => {
    acts.run.mockResolvedValue({ ok: true, value: undefined, note: COPY.shared.state.erased });
    renderUnderNext(
      <>
        <QuestionForm
          rules={{}}
          verb="delete"
          tone="danger"
          read={acts.read}
          run={acts.run}>
          <TextField
            label={COPY.shared.emailAddress}
            name="email"
            kind="email"
          />
        </QuestionForm>
        <ToastRegion frame="rail" />
      </>,
    );
    await userEvent.type(box(), ADDRESS);
    await userEvent.click(screen.getByRole("button", { name: VERB }));
    await userEvent.click(within(await screen.findByRole("alertdialog", { name: QUESTION })).getByRole("button", { name: VERB }));

    expect(await screen.findByRole("alertdialog", { name: COPY.shared.state.erased })).toBeTruthy();
    expect(acts.run).toHaveBeenCalledWith({ email: ADDRESS });
    expect(acts.touch).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog", { name: QUESTION })).toBeNull();
    });
  });

  // The harm: a refused erasure's address gone, so the repeat that reaches the account left standing is typed anew; or
  // its refusal said away from the question, whose press then has to be asked for again.
  it("shows a touched act's refusal on its question's line, its boxes kept, and the question's press runs the act again", async () => {
    acts.run.mockResolvedValue({ ok: false, reason: COPY.shared.failure.stale });
    await press();

    const question = await screen.findByRole("alertdialog", { name: QUESTION });
    await userEvent.click(within(question).getByRole("button", { name: VERB }));
    expect(await within(question).findByText(COPY.shared.failure.stale)).toBeTruthy();
    // Read under the question's modal, which hides the form from the accessibility tree while it stands.
    expect(screen.getByRole<HTMLInputElement>("textbox", { hidden: true }).value).toBe(ADDRESS);

    // React Aria takes no press on a busy button, so the next press waits for the one a person sees.
    const again = within(question).getByRole("button", { name: VERB });
    await waitFor(() => {
      expect(again.hasAttribute("data-pending")).toBe(false);
    });
    await userEvent.click(again);
    await waitFor(() => {
      expect(acts.run).toHaveBeenCalledTimes(2);
    });
    expect(acts.touch).toHaveBeenCalledTimes(2);
  });
});
