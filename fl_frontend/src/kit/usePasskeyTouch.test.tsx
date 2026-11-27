// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { COPY } from "@/core/copy/shared";
import { renderUnderNext } from "@/test-support/nextContexts";

import { ConfirmDialog } from "./ConfirmDialog";
import { Dialog } from "./Dialog";
import { TextField } from "./TextField";
import { ToastRegion } from "./Toast";

import type { ActionAnswer, DryRunAction } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { ReactElement } from "react";

const HOLDER = "anna@example.com";
const SIGNED_IN = { data: { status: true, email: HOLDER }, error: null };
// A refusal carrying no code of a closed sheet: an authenticator or the server turned the touch down.
const REFUSED = { data: null, error: { message: "refused" } };
// The edge's limit on the sign-in's requests, as the client answers its plain-text body: the status alone.
const RATE_REFUSED = { data: null, error: { status: 429, statusText: "Too Many Requests" } };
// The sheet the person closed, as `@simplewebauthn/browser` passes the browser's `NotAllowedError` through.
const CLOSED_SHEET = { data: null, error: { code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", message: "closed" } };
const DONE: ActionAnswer = { ok: true, value: undefined };

const passkey = vi.hoisted(() => ({ prompt: vi.fn() }));

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
  renderUnderNext(
    <>
      {drawn}
      <ToastRegion frame="rail" />
    </>,
  );

const VERB = COPY.shared.verb.delete;
const SUBJECT = COPY.shared.passkeys;
const ENTER = COPY.shared.verb.enter;

const question = (onConfirm: () => Promise<ActionAnswer>, touch?: { holder: string }) => (
  <ConfirmDialog
    question={{ verb: "delete", subject: SUBJECT, consequence: COPY.shared.failure.stale, tone: "danger" }}
    onConfirm={onConfirm}
    trigger={{ label: VERB }}
    {...(touch === undefined ? {} : { touch })}
  />
);

/**
 * A dialog act's run, called with `dryRun` true for its dry run, as a lane declaring one builds it; its form optional,
 * so one double stands for a question's act too.
 */
type Run = (formData?: FormData, dryRun?: boolean) => Promise<ActionAnswer>;

const inputs = (run: Run) => (
  <Dialog
    title={COPY.shared.help}
    act={{ verb: "enter" }}
    // The mark is the type's alone, which only the action builder gives a server action.
    run={run as DryRunAction<FormData>}
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

/** A touch's answer the case hands the prompt once it has read the page as the browser asks. */
function heldPrompt() {
  const answer = Promise.withResolvers<typeof SIGNED_IN>();
  // A prompt left open holds React's pending action, which every later case's transition would wait on.
  onTestFinished(() => answer.resolve(SIGNED_IN));
  passkey.prompt.mockReturnValueOnce(answer.promise);
  return answer;
}

// The harm: a touch ahead of a question spends the minute its session lasts on the question; a touched act answering
// where nobody stands to read it leaves the person guessing whether it ran; and a refusal said away from the question
// leaves its press to be found and asked again.
describe("a question behind the passkey touch", () => {
  it("steps aside at its final press while the prompt stands, then stands again busy until the act closes it", async () => {
    const answer = heldPrompt();
    const onConfirm = vi.fn<() => Promise<ActionAnswer>>(async () => DONE);
    renderWithToasts(question(onConfirm, { holder: HOLDER }));

    await userEvent.click(screen.getByRole("button", { name: VERB }));
    const asked = await screen.findByRole("alertdialog", { name: QUESTION });
    expect(passkey.prompt).not.toHaveBeenCalled();

    await pressIn(asked, VERB);
    await waitFor(() => expect(passkey.prompt).toHaveBeenCalledTimes(1));
    expect([onConfirm.mock.calls.length, screen.queryByRole("alertdialog", { name: QUESTION })]).toStrictEqual([0, null]);

    const held = Promise.withResolvers<ActionAnswer>();
    onTestFinished(() => held.resolve(DONE));
    onConfirm.mockReturnValueOnce(held.promise);
    await act(async () => answer.resolve(SIGNED_IN));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const standing = screen.getByRole("alertdialog", { name: QUESTION });
    expect(isBusy(within(standing).getByRole("button", { name: VERB }))).toBe(true);

    await act(async () => held.resolve(DONE));
    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: QUESTION })).toBeNull());
    expect(await toasted(COPY.shared.toast.done.delete)).toBe("done");
  });

  it.each([
    ["a refused touch", REFUSED, COPY.shared.touchMissing],
    ["the edge's limit on the touch", RATE_REFUSED, COPY.shared.failure.tooManyAttempts],
  ])("shows %s on its line, the act not run, and its next press asks again", async (_refusal, refused, line) => {
    passkey.prompt.mockResolvedValueOnce(refused).mockResolvedValueOnce(SIGNED_IN);
    const onConfirm = vi.fn(async () => DONE);
    renderWithToasts(question(onConfirm, { holder: HOLDER }));

    await userEvent.click(screen.getByRole("button", { name: VERB }));
    const asked = await screen.findByRole("alertdialog", { name: QUESTION });
    await pressIn(asked, VERB);

    expect(await within(asked).findByText(line)).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();

    await pressIn(asked, VERB);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(passkey.prompt).toHaveBeenCalledTimes(2);
  });

  it("stands again saying nothing where the person closed the sheet, the act not run", async () => {
    passkey.prompt.mockResolvedValueOnce(CLOSED_SHEET);
    const onConfirm = vi.fn(async () => DONE);
    renderWithToasts(question(onConfirm, { holder: HOLDER }));

    await userEvent.click(screen.getByRole("button", { name: VERB }));
    await pressIn(await screen.findByRole("alertdialog", { name: QUESTION }), VERB);

    const back = await screen.findByRole("button", { name: COPY.shared.back });
    await waitFor(() => expect(back.hasAttribute("disabled")).toBe(false));
    const standing = screen.getByRole("alertdialog", { name: QUESTION });
    const lines = [COPY.shared.touchMissing, COPY.shared.failure.unexpected].filter((line) => standing.textContent.includes(line));
    expect([onConfirm.mock.calls.length, lines]).toStrictEqual([0, []]);
  });
});

/** Opens the dialog of inputs and types `typed` into its one box. */
async function typeIntoTheDialog(typed: string) {
  await userEvent.click(screen.getByRole("button", { name: VERB }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByRole("textbox"), typed);
  return dialog;
}

/** The calls of a run that were the act itself, its dry runs left out. */
const writes = (run: { mock: { calls: readonly (readonly unknown[])[] } }) => run.mock.calls.filter(([, dryRun]) => dryRun !== true);

/** A run answering its dry run with `judged` and the act with `done`, each call and each prompt written into `order`. */
function judgedRun(judged: ActionAnswer, done: ActionAnswer = DONE) {
  const order: string[] = [];
  const run = vi.fn<Run>(async (_, dryRun) => {
    order.push(dryRun === true ? "dry run" : "act");
    return dryRun === true ? judged : done;
  });
  return { run, order };
}

// The harm: what was typed lost with a dialog that closed on a refusal, a fault shown nowhere near its field, and a
// touch spent on an input the server refuses.
describe("a dialog of inputs behind the passkey touch", () => {
  it("sends its dry run first, asks the touch once it passed, then posts with the holder and closes as the toast says done", async () => {
    const { run, order } = judgedRun(DONE);
    passkey.prompt.mockImplementationOnce(async () => {
      order.push("touch");
      return SIGNED_IN;
    });
    renderWithToasts(inputs(run));

    await pressIn(await typeIntoTheDialog("Berta"), ENTER);
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(order).toStrictEqual(["dry run", "touch", "act"]);
    const [[judged], [posted]] = run.mock.calls as [[FormData, boolean], [FormData]];
    expect([judged.get("name"), posted.get("name"), posted.get("holder")]).toStrictEqual(["Berta", "Berta", HOLDER]);
    expect(await toasted(COPY.shared.toast.done.enter)).toBe("done");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows its dry run's refusal under its field with the input kept, asking no touch", async () => {
    const { run } = judgedRun({ ok: false, fieldErrors: { name: COPY.shared.field.taken } });
    renderWithToasts(inputs(run));

    const dialog = await typeIntoTheDialog("Anna");
    await pressIn(dialog, ENTER);
    expect(await within(dialog).findByText(COPY.shared.field.taken)).toBeTruthy();
    expect([passkey.prompt.mock.calls.length, writes(run).length]).toStrictEqual([0, 0]);
    expect(within(dialog).getByRole<HTMLInputElement>("textbox").value).toBe("Anna");
  });

  it("stands again with its input and a refused touch on its line, the act not run, and its next press asks again", async () => {
    passkey.prompt.mockResolvedValueOnce(REFUSED).mockResolvedValueOnce(SIGNED_IN);
    const { run } = judgedRun(DONE);
    renderWithToasts(inputs(run));

    const dialog = await typeIntoTheDialog("Anna");
    await pressIn(dialog, ENTER);
    expect(await within(dialog).findByText(COPY.shared.touchMissing)).toBeTruthy();
    expect([writes(run).length, within(dialog).getByRole<HTMLInputElement>("textbox").value]).toStrictEqual([0, "Anna"]);

    await pressIn(dialog, ENTER);
    await waitFor(() => expect(writes(run)).toHaveLength(1));
    expect((writes(run)[0]?.[0] as FormData).get("name")).toBe("Anna");
  });

  it("stands again with its input and the act's refusal under its field, where a record changed under the touch", async () => {
    passkey.prompt.mockResolvedValueOnce(SIGNED_IN);
    const { run } = judgedRun(DONE, { ok: false, fieldErrors: { name: COPY.shared.field.taken } });
    renderWithToasts(inputs(run));

    const dialog = await typeIntoTheDialog("Anna");
    await pressIn(dialog, ENTER);
    expect(await within(dialog).findByText(COPY.shared.field.taken)).toBeTruthy();
    expect(within(dialog).getByRole<HTMLInputElement>("textbox").value).toBe("Anna");
  });

  it("stands again with its input and no line where the person closed the sheet, the act not run", async () => {
    passkey.prompt.mockResolvedValueOnce(CLOSED_SHEET);
    const { run } = judgedRun(DONE);
    renderWithToasts(inputs(run));

    const dialog = await typeIntoTheDialog("Anna");
    await pressIn(dialog, ENTER);
    const save = within(dialog).getByRole("button", { name: ENTER });
    await waitFor(() => expect(isBusy(save)).toBe(false));
    expect([writes(run).length, within(dialog).getByRole<HTMLInputElement>("textbox").value, screen.queryByRole("dialog")]).toStrictEqual([
      0,
      "Anna",
      dialog,
    ]);
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
    { name: "a question", draw: (act: () => Promise<ActionAnswer>) => question(act, { holder: HOLDER }), role: "alertdialog", press: VERB },
    { name: "a dialog of inputs", draw: inputs, role: "dialog", press: ENTER },
  ] as const;

  it.each(cases)("is asked once the dialog stands aside and nothing is inert, from $name", async ({ draw, role, press }) => {
    const { standing, drawn } = extensionPrompt();
    const answer = Promise.withResolvers<typeof SIGNED_IN>();
    onTestFinished(() => answer.resolve(SIGNED_IN));
    // Read as the browser asks, which is when the prompt draws: free then, not only some render later.
    let asAsked: { shown: boolean; blocked: boolean } | null = null;
    passkey.prompt.mockImplementationOnce(() => {
      asAsked = { shown: screen.queryByRole(role) !== null, blocked: isBlocked(standing) };
      document.body.append(drawn);
      return answer.promise;
    });
    const onConfirm = vi.fn<Run>(async () => DONE);
    renderUnderNext(draw(onConfirm));

    await userEvent.click(screen.getByRole("button", { name: VERB }));
    const asked = await screen.findByRole(role);
    expect(isBlocked(standing)).toBe(true);
    await pressIn(asked, press);
    await waitFor(() => expect(passkey.prompt).toHaveBeenCalledTimes(1));

    expect([asAsked, isBlocked(standing), isBlocked(drawn)]).toStrictEqual([{ shown: false, blocked: false }, false, false]);
    // Nor does a modal's focus trap pull a press on the prompt back into a dialog.
    await userEvent.click(drawn);
    expect(document.activeElement).toBe(drawn);
    expect(writes(onConfirm)).toHaveLength(0);

    await act(async () => answer.resolve(SIGNED_IN));
    await waitFor(() => expect(writes(onConfirm)).toHaveLength(1));
  });
});
