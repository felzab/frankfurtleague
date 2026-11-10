// @vitest-environment jsdom
import { Activity } from "react";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { QuestionForm } from "./QuestionForm";
import { TextField } from "./TextField";

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
      width="standard"
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

  // The harm: the touch ahead of the question, or the act sending what the boxes hold rather than what the read held.
  it("runs the act behind the touch on the read's input, emptying the boxes under its done line", async () => {
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

  it("stays open on an act's refusal, its boxes kept, and its press runs the act again", async () => {
    acts.act.mockResolvedValue({ ok: false, reason: COPY.admin.erasure.partial });
    await press();

    const question = await screen.findByRole("alertdialog");
    const final = within(question).getByRole("button", { name: VERB });
    await userEvent.click(final);
    expect(await within(question).findByText(COPY.admin.erasure.partial)).toBeTruthy();

    await userEvent.click(final);
    await waitFor(() => {
      expect(acts.act).toHaveBeenCalledTimes(2);
    });
    await userEvent.click(within(question).getByRole("button", { name: COPY.shared.back }));
    await waitFor(() => {
      expect(box().value).toBe(ADDRESS);
    });
  });
});
