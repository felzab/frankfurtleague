// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { COPY } from "@/core/copy";

import { ConfirmDialog } from "./ConfirmDialog";
import { Dialog } from "./Dialog";
import { TextField } from "./TextField";
import { ToastRegion } from "./Toast";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { ReactElement } from "react";

const HOLDER = "anna@example.com";
const SIGNED_IN = { data: { status: true, email: HOLDER }, error: null };
const CANCELLED = { data: null, error: { message: "cancelled" } };
const DONE: ActionAnswer = { ok: true, value: undefined };

const passkey = vi.hoisted(() => ({ prompt: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/core/auth/browserClient", () => ({
  loadAuthClient: async () => ({ signIn: { passkey: passkey.prompt } }),
  usePreloadedAuthClient: () => undefined,
}));
beforeEach(() => {
  passkey.prompt.mockReset();
});

// The toast queue is the module's own, so a toast outlives its case: each is closed while the case's region stands.
afterEach(() => {
  for (const close of screen.queryAllByRole("button", { name: COPY.shared.close })) act(() => close.click());
});

/** What a case draws, with the frame's toast region beside it. */
const renderWithToasts = (drawn: ReactElement) =>
  render(
    <>
      {drawn}
      <ToastRegion frame="rail" />
    </>,
  );

const VERB = COPY.shared.verb.delete;
const SUBJECT = COPY.account.passkeys.title;
const ENTER = COPY.shared.verb.enter;

const question = (onConfirm: () => Promise<ActionAnswer>, touch?: { holder: string }) => (
  <ConfirmDialog
    verb="delete"
    subject={SUBJECT}
    consequence={COPY.shared.failure.stale}
    tone="danger"
    onConfirm={onConfirm}
    trigger={{ label: VERB }}
    {...(touch === undefined ? {} : { touch })}
  />
);

const inputs = (action: (formData: FormData) => Promise<ActionAnswer>) => (
  <Dialog
    title={COPY.shared.help}
    act={{ verb: "enter" }}
    action={action}
    touch={{ holder: HOLDER }}
    trigger={{ label: VERB }}>
    <TextField
      label={COPY.shared.name}
      name="name"
      kind="text"
    />
  </Dialog>
);

const pressIn = (scope: HTMLElement, name: string) => userEvent.click(within(scope).getByRole("button", { name }));

/** The question's name: a toast is an alert dialog too. */
const QUESTION = COPY.shared.question(SUBJECT, "delete");

/** Whether the toast saying `words` says the act was done or refused, by its tone. */
async function toasted(words: Copy): Promise<"done" | "refused" | "neither"> {
  const toast = await screen.findByRole("alertdialog", { name: words });
  if (toast.querySelector(".text-success") !== null) return "done";
  return toast.querySelector(".text-danger") !== null ? "refused" : "neither";
}

const isBusy = (button: HTMLElement) => button.hasAttribute("data-pending");

// The harm: a touch ahead of a dialog spends the minute its session lasts on the dialog, and a touch skipped reaches the
// lane's refusal in words that name a confirmation nobody was asked for; a touched act answering where nobody stands to
// read it leaves the person guessing whether it ran.
describe("a question behind the passkey touch", () => {
  it("closes at its final press, then asks the touch and runs the act, its trigger busy until the toast says done", async () => {
    let answer = (_: typeof SIGNED_IN) => {};
    passkey.prompt.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const onConfirm = vi.fn(async () => DONE);
    renderWithToasts(question(onConfirm, { holder: HOLDER }));

    const trigger = screen.getByRole("button", { name: VERB });
    await userEvent.click(trigger);
    const asked = await screen.findByRole("alertdialog", { name: QUESTION });
    expect(passkey.prompt).not.toHaveBeenCalled();

    await pressIn(asked, VERB);
    await waitFor(() => expect(passkey.prompt).toHaveBeenCalledTimes(1));
    expect(onConfirm).not.toHaveBeenCalled();
    expect([screen.queryByRole("alertdialog", { name: QUESTION }), isBusy(trigger)]).toStrictEqual([null, true]);

    await act(async () => answer(SIGNED_IN));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(isBusy(trigger)).toBe(false));
    expect(await toasted(COPY.shared.toast.done.delete)).toBe("done");
  });

  it("toasts a refused touch, the act not run, its trigger standing for a new question that asks again", async () => {
    passkey.prompt.mockResolvedValueOnce(CANCELLED).mockResolvedValueOnce(SIGNED_IN);
    const onConfirm = vi.fn(async () => DONE);
    renderWithToasts(question(onConfirm, { holder: HOLDER }));

    const trigger = screen.getByRole("button", { name: VERB });
    await userEvent.click(trigger);
    await pressIn(await screen.findByRole("alertdialog", { name: QUESTION }), VERB);

    expect(await toasted(COPY.signIn.refusal.unverified)).toBe("refused");
    expect([onConfirm.mock.calls.length, screen.queryByRole("alertdialog", { name: QUESTION }), isBusy(trigger)]).toStrictEqual([
      0,
      null,
      false,
    ]);

    await userEvent.click(trigger);
    await pressIn(await screen.findByRole("alertdialog", { name: QUESTION }), VERB);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(passkey.prompt).toHaveBeenCalledTimes(2);
  });
});

describe("a dialog of inputs behind the passkey touch", () => {
  it("toasts a refused touch, the act not run, and posts what the next opening's press sends with the holder", async () => {
    passkey.prompt.mockResolvedValueOnce(CANCELLED).mockResolvedValueOnce(SIGNED_IN);
    const action = vi.fn(async (_: FormData) => DONE);
    renderWithToasts(inputs(action));

    const trigger = screen.getByRole("button", { name: VERB });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("textbox"), "Anna");
    expect(passkey.prompt).not.toHaveBeenCalled();

    await pressIn(dialog, ENTER);
    expect(await toasted(COPY.signIn.refusal.unverified)).toBe("refused");
    expect([action.mock.calls.length, screen.queryByRole("dialog"), isBusy(trigger)]).toStrictEqual([0, null, false]);

    await userEvent.click(trigger);
    const again = await screen.findByRole("dialog");
    await userEvent.type(within(again).getByRole("textbox"), "Berta");
    await pressIn(again, ENTER);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const posted = action.mock.calls[0]?.[0];
    expect([posted?.get("name"), posted?.get("holder")]).toStrictEqual(["Berta", HOLDER]);
    expect(await toasted(COPY.shared.toast.done.enter)).toBe("done");
  });
});

/**
 * What a password manager draws its passkey prompt in: an element of its own under the body, standing from the page's
 * load, or added as the prompt opens, as the prompt's own button is here. React Aria's modal marks every element outside
 * it, and every one added later, `inert` (`aria-hidden` here, jsdom having no `inert`), and an inert prompt takes no press
 * and no Escape; its focus trap pulls a press outside back into the dialog.
 */
function extensionPrompt() {
  const standing = document.body.appendChild(document.createElement("div"));
  const drawn = document.createElement("button");
  onTestFinished(() => {
    standing.remove();
    drawn.remove();
  });
  return { standing, drawn };
}

const isBlocked = (element: Element) => element.closest('[inert], [aria-hidden="true"]') !== null;

// The harm: the prompt drawn under a dialog's modal takes no press and cannot be dismissed, and the page hangs.
describe("the browser's passkey prompt after a dialog", () => {
  const cases = [
    { name: "a question", draw: (act: () => Promise<ActionAnswer>) => question(act, { holder: HOLDER }), role: "alertdialog", press: VERB },
    { name: "a dialog of inputs", draw: inputs, role: "dialog", press: ENTER },
  ] as const;

  it.each(cases)("is asked once no modal stands and nothing is inert, from $name", async ({ draw, role, press }) => {
    const { standing, drawn } = extensionPrompt();
    let answer = (_: typeof SIGNED_IN) => {};
    // A prompt left open holds React's pending action, which every later case's transition would wait on.
    onTestFinished(() => answer(SIGNED_IN));
    // Read as the browser asks, which is when the prompt draws: free then, not only some render later.
    let asAsked: { modal: boolean; blocked: boolean } | null = null;
    passkey.prompt.mockImplementationOnce(() => {
      asAsked = { modal: document.querySelector('[role="dialog"], [role="alertdialog"]') !== null, blocked: isBlocked(standing) };
      document.body.append(drawn);
      return new Promise((resolve) => (answer = resolve));
    });
    const onConfirm = vi.fn(async () => DONE);
    render(draw(onConfirm));

    await userEvent.click(screen.getByRole("button", { name: VERB }));
    const asked = await screen.findByRole(role);
    expect(isBlocked(standing)).toBe(true);
    await pressIn(asked, press);
    await waitFor(() => expect(passkey.prompt).toHaveBeenCalledTimes(1));

    expect([asAsked, isBlocked(standing), isBlocked(drawn)]).toStrictEqual([{ modal: false, blocked: false }, false, false]);
    // Nor does a modal's focus trap pull a press on the prompt back into a dialog.
    await userEvent.click(drawn);
    expect(document.activeElement).toBe(drawn);
    expect(onConfirm).not.toHaveBeenCalled();

    await act(async () => answer(SIGNED_IN));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });
});
