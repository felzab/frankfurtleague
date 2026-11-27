// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ACCOUNT_COPY } from "@/core/copy/account";
import { COPY } from "@/core/copy/shared";
import { renderUnderNext } from "@/test-support/nextContexts";

import { AccountBox, AccountRows } from "./AccountBox";
import { ToastRegion } from "./Toast";

import type { ActionAnswer } from "@/core/action";

const PASSKEY = COPY.shared.passkeys;
const REFUSAL = COPY.shared.failure.stale;
/** The box's own done word, which is not its verb's. */
const OWN_WORD = COPY.shared.toast.linkSent;
const CONSEQUENCE = ACCOUNT_COPY.passkeys.endsDevices;
/** The question's name: a toast is an alert dialog too. */
const QUESTION = COPY.shared.question(PASSKEY, "delete");

/** The question's own act button, beside „Zurück“. */
const confirmIn = (question: HTMLElement, verb: keyof typeof COPY.shared.verb) =>
  within(question).getByRole("button", { name: COPY.shared.verb[verb] });

// The toast queue is the module's own, so a toast outlives its case: each is closed while the case's region stands.
afterEach(() => {
  for (const close of screen.queryAllByRole("button", { name: COPY.shared.close })) act(() => close.click());
});

// A Konto box's act asking first answers in its question as every question does: a refusal closing the question would
// leave the reason shown nowhere, and a done act, once the question has gone, says itself in the box's one toast, in
// the box's own word rather than its verb's: „Konto löschen“ has only sent a link when it is done, and „Gelöscht“
// would tell the person the account is gone, the mailed link left unopened.
describe("a Konto box's act behind a question", () => {
  it("keeps the question open with a refusal, and once done says the box's own word in one toast", async () => {
    const run = vi
      .fn<() => Promise<ActionAnswer<unknown>>>()
      .mockResolvedValueOnce({ ok: false, reason: REFUSAL })
      .mockResolvedValueOnce({ ok: true, value: undefined });
    renderUnderNext(
      <>
        <AccountBox
          title={PASSKEY}
          description={ACCOUNT_COPY.passkeys.description}
          act={{
            run,
            button: { confirm: { verb: "delete", subject: PASSKEY, consequence: CONSEQUENCE, tone: "danger" } },
            done: OWN_WORD,
          }}
        />
        <ToastRegion frame="rail" />
      </>,
    );

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.withObject(PASSKEY, "delete") }));
    const question = screen.getByRole("alertdialog", { name: QUESTION });
    await userEvent.click(confirmIn(question, "delete"));
    await within(question).findByText(REFUSAL);

    await userEvent.click(confirmIn(question, "delete"));
    await screen.findByRole("alertdialog", { name: OWN_WORD });
    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: QUESTION })).toBeNull());
    expect(run).toHaveBeenCalledTimes(2);
    // The box's word alone: the box's line says nothing, nor does the question's verb raise a toast of its own.
    expect([screen.getAllByRole("alertdialog").length, screen.getByRole("status").textContent]).toStrictEqual([1, ""]);
  });
});

describe("a locked Konto box", () => {
  const reason = COPY.template.draftUnsaved;

  // The harm: a locked button is no submit button, and a form without one still submits on Enter from a lone field.
  it("runs nothing on Enter from its field", async () => {
    const run = vi.fn<() => Promise<ActionAnswer<unknown>>>();
    renderUnderNext(
      <AccountBox
        title={PASSKEY}
        description={ACCOUNT_COPY.passkeys.description}
        act={{ run, button: { label: COPY.shared.withObject(PASSKEY, "setUp") }, done: COPY.shared.toast.done.setUp, locked: reason }}>
        <input
          aria-label={COPY.shared.name}
          name="name"
        />
      </AccountBox>,
    );

    await userEvent.type(screen.getByRole("textbox"), "Laptop{Enter}");
    expect(run).not.toHaveBeenCalled();
  });

  // The harm: a dialog's trigger around the locked button would open the question behind the reason.
  it("answers a press with its reason, never the question", async () => {
    renderUnderNext(
      <AccountBox
        title={PASSKEY}
        description={ACCOUNT_COPY.passkeys.description}
        act={{
          run: vi.fn<() => Promise<ActionAnswer<unknown>>>(),
          button: { confirm: { verb: "delete", subject: PASSKEY, consequence: CONSEQUENCE, tone: "danger" } },
          done: COPY.shared.toast.done.delete,
          locked: reason,
        }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.withObject(PASSKEY, "delete") }));
    expect((await screen.findByRole("tooltip")).textContent).toBe(reason);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

// A row's removal hands its act straight to the question: a refusal must stand in the question, not close it.
describe("a Konto row's removal", () => {
  it("asks first, keeps the question open with a refusal, and closes once the removal is done", async () => {
    const run = vi
      .fn<() => Promise<ActionAnswer<unknown>>>()
      .mockResolvedValueOnce({ ok: false, reason: REFUSAL })
      .mockResolvedValueOnce({ ok: true, value: undefined });
    renderUnderNext(
      <AccountRows
        rows={[
          {
            id: "passkey-1",
            name: { record: "Laptop" },
            detail: PASSKEY,
            remove: { verb: "delete", subject: PASSKEY, consequence: CONSEQUENCE, run },
          },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.delete }));
    const question = await screen.findByRole("alertdialog");
    expect(run).not.toHaveBeenCalled();
    await userEvent.click(confirmIn(question, "delete"));
    await within(question).findByText(REFUSAL);

    await userEvent.click(confirmIn(question, "delete"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(run).toHaveBeenCalledTimes(2);
  });
});
