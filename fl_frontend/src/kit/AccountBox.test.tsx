// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { renderUnderNext } from "@/test-support/nextContexts";

import { AccountBox, AccountRows } from "./AccountBox";

import type { ActionAnswer } from "@/core/action";

const PASSKEY = COPY.shared.passkeys;
const REFUSAL = COPY.shared.failure.stale;
const NOTE = COPY.shared.toast.linkSent;
const CONSEQUENCE = COPY.account.passkeys.endsDevices;

/** The question's own act button, beside „Zurück“. */
const confirmIn = (question: HTMLElement, verb: keyof typeof COPY.shared.verb) =>
  within(question).getByRole("button", { name: COPY.shared.verb[verb] });

// A Konto box's act asking first answers in its question as every question does: a refusal closing the question would
// leave the reason shown nowhere, and a done act's note belongs on the box's own line once the question has gone.
describe("a Konto box's act behind a question", () => {
  it("keeps the question open with a refusal, and once done says the act's note on the box's line", async () => {
    const run = vi
      .fn<() => Promise<ActionAnswer<unknown>>>()
      .mockResolvedValueOnce({ ok: false, reason: REFUSAL })
      .mockResolvedValueOnce({ ok: true, value: undefined, note: NOTE });
    renderUnderNext(
      <AccountBox
        title={PASSKEY}
        description={COPY.account.passkeys.description}
        act={{ run, button: { confirm: { verb: "delete", subject: PASSKEY, consequence: CONSEQUENCE, tone: "danger" } } }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.withObject(PASSKEY, "delete") }));
    await userEvent.click(confirmIn(screen.getByRole("alertdialog"), "delete"));
    const question = await screen.findByRole("alertdialog");
    await within(question).findByText(REFUSAL);

    await userEvent.click(confirmIn(question, "delete"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(run).toHaveBeenCalledTimes(2);
    expect(screen.getByText(NOTE)).toBeTruthy();
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
        description={COPY.account.passkeys.description}
        act={{ run, button: { label: COPY.shared.withObject(PASSKEY, "setUp") }, locked: reason }}>
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
        description={COPY.account.passkeys.description}
        act={{
          run: vi.fn(),
          button: { confirm: { verb: "delete", subject: PASSKEY, consequence: CONSEQUENCE, tone: "danger" } },
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
