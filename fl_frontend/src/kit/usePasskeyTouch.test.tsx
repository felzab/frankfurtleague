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

import type { ActionAnswer } from "@/core/action";
import type { EndState } from "./OneShot";

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

beforeEach(() => passkey.prompt.mockReset());

const VERB = COPY.shared.verb.delete;
const SUBJECT = COPY.account.passkeys.title;

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

const pressIn = (scope: HTMLElement, name: string) => userEvent.click(within(scope).getByRole("button", { name }));

// The harm: a touch ahead of a dialog spends the minute its session lasts on the dialog, and a touch skipped reaches the
// lane's refusal in words that name a confirmation nobody was asked for.
describe("a question behind the passkey touch", () => {
  it("asks the touch from its final press alone, then runs the act, its button busy until the prompt answers", async () => {
    let answer = (_: typeof SIGNED_IN) => {};
    passkey.prompt.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const onConfirm = vi.fn(async () => DONE);
    render(question(onConfirm, { holder: HOLDER }));

    await userEvent.click(screen.getByRole("button", { name: VERB }));
    const asked = await screen.findByRole("alertdialog");
    expect(passkey.prompt).not.toHaveBeenCalled();

    await pressIn(asked, VERB);
    await waitFor(() => expect(passkey.prompt).toHaveBeenCalledTimes(1));
    expect(onConfirm).not.toHaveBeenCalled();
    // The one state the act's busy button and „Zurück“ share, which the prompt must not end early: read through the
    // question standing aside while the prompt does, as it shows again.
    expect(within(asked).getByRole("button", { name: COPY.shared.back, hidden: true }).hasAttribute("disabled")).toBe(true);

    await act(async () => answer(SIGNED_IN));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("stands open on a refused touch with the shared line, the act not run, and asks again on the next press", async () => {
    passkey.prompt.mockResolvedValueOnce(CANCELLED).mockResolvedValueOnce(SIGNED_IN);
    const onConfirm = vi.fn(async () => DONE);
    render(question(onConfirm, { holder: HOLDER }));

    await userEvent.click(screen.getByRole("button", { name: VERB }));
    const asked = await screen.findByRole("alertdialog");
    await pressIn(asked, VERB);

    await within(asked).findByText(COPY.signIn.refusal.unverified);
    expect(onConfirm).not.toHaveBeenCalled();

    await pressIn(asked, VERB);
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
  it("keeps what was typed on a refused touch, and posts it with the holder on the next press", async () => {
    passkey.prompt.mockResolvedValueOnce(CANCELLED).mockResolvedValueOnce(SIGNED_IN);
    const action = vi.fn(async (_: FormData) => DONE);
    render(
      <Dialog
        title={COPY.shared.help}
        act={{ verb: "save" }}
        action={action}
        touch={{ holder: HOLDER }}
        trigger={{ label: COPY.shared.help }}>
        <TextField
          label={COPY.shared.name}
          name="name"
          kind="text"
        />
      </Dialog>,
    );

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.help }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("textbox"), "Anna");
    expect(passkey.prompt).not.toHaveBeenCalled();

    await pressIn(dialog, COPY.shared.verb.save);
    await within(dialog).findByText(COPY.signIn.refusal.unverified);
    expect(action).not.toHaveBeenCalled();
    expect(within(dialog).getByRole<HTMLInputElement>("textbox").value).toBe("Anna");

    await pressIn(dialog, COPY.shared.verb.save);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const posted = action.mock.calls[0]?.[0];
    expect([posted?.get("name"), posted?.get("holder")]).toStrictEqual(["Anna", HOLDER]);
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
describe("the browser's passkey prompt over a dialog", () => {
  const cases = [
    {
      name: "a question",
      draw: (onConfirm: () => Promise<ActionAnswer>) => question(onConfirm, { holder: HOLDER }),
      role: "alertdialog",
      press: VERB,
    },
    {
      name: "a dialog of inputs",
      draw: (onConfirm: () => Promise<ActionAnswer>) => (
        <Dialog
          title={COPY.shared.help}
          act={{ verb: "save" }}
          action={onConfirm}
          touch={{ holder: HOLDER }}
          trigger={{ label: VERB }}>
          <TextField
            label={COPY.shared.name}
            name="name"
            kind="text"
          />
        </Dialog>
      ),
      role: "dialog",
      press: COPY.shared.verb.save,
    },
  ] as const;

  it.each(cases)("stands over a page no modal blocks while it is open, from $name", async ({ draw, role, press }) => {
    const { standing, drawn } = extensionPrompt();
    let answer = (_: typeof SIGNED_IN) => {};
    // A prompt left open holds React's pending action, which every later case's transition would wait on.
    onTestFinished(() => answer(SIGNED_IN));
    // Read as the browser asks, which is when the prompt draws: free then, not only some render later.
    let blockedAsAsked: boolean | null = null;
    passkey.prompt.mockImplementationOnce(() => {
      blockedAsAsked = isBlocked(standing);
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

    expect([blockedAsAsked, isBlocked(standing), isBlocked(drawn)]).toStrictEqual([false, false, false]);
    // Nor does the modal's focus trap pull a press on the prompt back into the dialog.
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
