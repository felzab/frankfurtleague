// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { COPY } from "@/core/copy";

import { AccountBox } from "./AccountBox";
import { ConfirmDialog } from "./ConfirmDialog";
import { Dialog } from "./Dialog";
import { OneShotForm } from "./OneShot";
import { TextField } from "./TextField";
import { toastAnswer } from "./Toast";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { EndState } from "./OneShot";
import type * as ToastModule from "./Toast";

const HOLDER = "anna@example.com";
const SIGNED_IN = { data: { status: true, email: HOLDER }, error: null };
const CANCELLED = { data: null, error: { message: "cancelled" } };
const DONE: ActionAnswer = { ok: true, value: undefined };
const END: ActionAnswer<EndState> = {
  ok: true,
  value: { tone: "success", title: COPY.shared.saved, next: { label: COPY.shared.back, href: "/" } },
};

const passkey = vi.hoisted(() => ({ prompt: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/core/auth/browserClient", () => ({
  loadAuthClient: async () => ({ signIn: { passkey: passkey.prompt } }),
  usePreloadedAuthClient: () => undefined,
}));
// Read off the call rather than the region: the toast queue is the module's own, and a toast outlives its test.
vi.mock("./Toast", async (original) => {
  const toast = await original<typeof ToastModule>();
  return { ...toast, toastAnswer: vi.fn(toast.toastAnswer) };
});

beforeEach(() => {
  passkey.prompt.mockReset();
  vi.mocked(toastAnswer).mockClear();
});

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

/** What the act's toast said: done or not, in which words. */
function toasted(): [boolean, Copy | undefined] {
  const [answer, done] = vi.mocked(toastAnswer).mock.lastCall ?? [];
  if (answer === undefined) return [false, undefined];
  return answer.ok ? [true, answer.note ?? done] : [false, answer.reason];
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
    render(question(onConfirm, { holder: HOLDER }));

    const trigger = screen.getByRole("button", { name: VERB });
    await userEvent.click(trigger);
    const asked = await screen.findByRole("alertdialog");
    expect(passkey.prompt).not.toHaveBeenCalled();

    await pressIn(asked, VERB);
    await waitFor(() => expect(passkey.prompt).toHaveBeenCalledTimes(1));
    expect(onConfirm).not.toHaveBeenCalled();
    expect([screen.queryByRole("alertdialog"), isBusy(trigger)]).toStrictEqual([null, true]);

    await act(async () => answer(SIGNED_IN));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(isBusy(trigger)).toBe(false));
    expect(toasted()).toStrictEqual([true, COPY.shared.toast.done.delete]);
  });

  it("toasts a refused touch, the act not run, its trigger standing for a new question that asks again", async () => {
    passkey.prompt.mockResolvedValueOnce(CANCELLED).mockResolvedValueOnce(SIGNED_IN);
    const onConfirm = vi.fn(async () => DONE);
    render(question(onConfirm, { holder: HOLDER }));

    const trigger = screen.getByRole("button", { name: VERB });
    await userEvent.click(trigger);
    await pressIn(await screen.findByRole("alertdialog"), VERB);

    await waitFor(() => expect(toasted()).toStrictEqual([false, COPY.signIn.refusal.unverified]));
    expect([onConfirm.mock.calls.length, screen.queryByRole("alertdialog"), isBusy(trigger)]).toStrictEqual([0, null, false]);

    await userEvent.click(trigger);
    await pressIn(await screen.findByRole("alertdialog"), VERB);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(passkey.prompt).toHaveBeenCalledTimes(2);
  });

  it("asks a person holding no passkey nothing", async () => {
    const onConfirm = vi.fn(async () => DONE);
    render(question(onConfirm));

    await userEvent.click(screen.getByRole("button", { name: VERB }));
    await pressIn(await screen.findByRole("alertdialog"), VERB);

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(passkey.prompt).not.toHaveBeenCalled();
  });
});

describe("a dialog of inputs behind the passkey touch", () => {
  it("toasts a refused touch, the act not run, and posts what the next opening's press sends with the holder", async () => {
    passkey.prompt.mockResolvedValueOnce(CANCELLED).mockResolvedValueOnce(SIGNED_IN);
    const action = vi.fn(async (_: FormData) => DONE);
    render(inputs(action));

    const trigger = screen.getByRole("button", { name: VERB });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("textbox"), "Anna");
    expect(passkey.prompt).not.toHaveBeenCalled();

    await pressIn(dialog, ENTER);
    await waitFor(() => expect(toasted()).toStrictEqual([false, COPY.signIn.refusal.unverified]));
    expect([action.mock.calls.length, screen.queryByRole("dialog"), isBusy(trigger)]).toStrictEqual([0, null, false]);

    await userEvent.click(trigger);
    const again = await screen.findByRole("dialog");
    await userEvent.type(within(again).getByRole("textbox"), "Berta");
    await pressIn(again, ENTER);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const posted = action.mock.calls[0]?.[0];
    expect([posted?.get("name"), posted?.get("holder")]).toStrictEqual(["Berta", HOLDER]);
    await waitFor(() => expect(toasted()).toStrictEqual([true, COPY.shared.toast.done.enter]));
  });

  // A field's phrase, or the line pointing at the fields, with no field left in sight tells the person nothing true: a
  // touched act words its refusals as sentences, and one it does not word is the shared failure.
  it("toasts a refusal carrying a field's phrase alone as the shared failure, never the phrase or the fields' pointer", async () => {
    passkey.prompt.mockResolvedValueOnce(SIGNED_IN);
    const action = vi.fn(async (_: FormData): Promise<ActionAnswer> => ({ ok: false, fieldErrors: { name: COPY.shared.field.taken } }));
    render(inputs(action));

    await userEvent.click(screen.getByRole("button", { name: VERB }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("textbox"), "Anna");
    await pressIn(dialog, ENTER);

    await waitFor(() => expect(vi.mocked(toastAnswer)).toHaveBeenCalledOnce());
    // No reason: `toastAnswer` says its failure line.
    expect(toasted()).toStrictEqual([false, undefined]);
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

// The two acts with no dialog: their one press is the final press.
describe("an act pressed where it stands", () => {
  it("in a Konto box answers a refused touch on the box's line, the act not run", async () => {
    passkey.prompt.mockResolvedValueOnce(CANCELLED);
    const run = vi.fn(async () => DONE);
    render(
      <AccountBox
        title={SUBJECT}
        description={COPY.account.passkeys.description}
        act={{ run, carry: { holder: HOLDER }, button: { label: VERB }, touch: true }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: VERB }));

    await screen.findByText(COPY.signIn.refusal.unverified);
    expect(run).not.toHaveBeenCalled();
  });

  it("in a one-shot form touches for the main act alone", async () => {
    passkey.prompt.mockResolvedValueOnce(CANCELLED).mockResolvedValueOnce(SIGNED_IN);
    const action = vi.fn(async (_: FormData) => END);
    render(
      <OneShotForm
        head={<h1>{COPY.shared.help}</h1>}
        action={action}
        acts={{
          primary: COPY.shared.verb.save,
          refusal: { verb: "delete", subject: COPY.shared.entry, consequence: COPY.admin.addressChange.previousStays },
        }}
        carry={{ holder: HOLDER }}
        touch
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));
    await screen.findByText(COPY.signIn.refusal.unverified);
    expect(action).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.delete }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: COPY.shared.verb.delete }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(passkey.prompt).toHaveBeenCalledTimes(1);
  });
});
