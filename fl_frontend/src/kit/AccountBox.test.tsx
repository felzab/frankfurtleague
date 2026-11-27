// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ACCOUNT_COPY } from "@/core/copy/account";
import { COPY } from "@/core/copy/shared";
import { renderUnderNext } from "@/test-support/nextContexts";

import { AccountBox, AccountRows } from "./AccountBox";
import { TextField } from "./TextField";
import { ToastRegion } from "./Toast";

import type { ActionAnswer, DryRunAction } from "@/core/action";

const passkey = vi.hoisted(() => ({ prompt: vi.fn() }));

vi.mock("@/core/auth/browserClient", () => ({
  loadAuthClient: async () => ({ signIn: { passkey: passkey.prompt } }),
  usePreloadedAuthClient: () => undefined,
}));

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

// The harm: an administrator's address change refused after the touch, which then has to be given again for the
// corrected address, where the dry run would have shown the refusal on the box first.
describe("a Konto box's act behind the passkey touch, its dry run declared", () => {
  it("shows its dry run's refusal on the box asking no touch, and once it passes asks the touch, then runs the act", async () => {
    const HOLDER = "anna@example.com";
    const order: string[] = [];
    const run = async (_formData: FormData, dryRun?: boolean): Promise<ActionAnswer<unknown>> => {
      order.push(dryRun === true ? "dry run" : "act");
      // The first dry run refuses the address on its box; the next passes.
      return order.length === 1 ? { ok: false, fieldErrors: { email: COPY.shared.field.taken } } : { ok: true, value: undefined };
    };
    passkey.prompt.mockImplementationOnce(async () => {
      order.push("touch");
      return { data: { status: true, email: HOLDER }, error: null };
    });
    renderUnderNext(
      <>
        <AccountBox
          title={COPY.shared.emailAddress}
          description={ACCOUNT_COPY.address.description}
          act={{
            // The mark is the type's alone, which only the action builder gives a server action.
            run: run as DryRunAction<FormData>,
            dryRun: true,
            button: { label: COPY.shared.withObject(COPY.shared.link, "send") },
            done: OWN_WORD,
            touch: { holder: HOLDER },
          }}>
          <TextField
            label={COPY.shared.addressChange.new}
            name="email"
            kind="email"
          />
        </AccountBox>
        <ToastRegion frame="rail" />
      </>,
    );
    const send = screen.getByRole("button", { name: COPY.shared.withObject(COPY.shared.link, "send") });

    await userEvent.type(screen.getByRole("textbox"), "anna.neu@example.com");
    await userEvent.click(send);
    expect(await screen.findByText(COPY.shared.field.taken)).toBeTruthy();
    expect([order, screen.getByRole<HTMLInputElement>("textbox").value]).toStrictEqual([["dry run"], "anna.neu@example.com"]);

    // The refusal holds the box until the person corrects it.
    await waitFor(() => expect(send.hasAttribute("data-pending")).toBe(false));
    await userEvent.clear(screen.getByRole("textbox"));
    await userEvent.type(screen.getByRole("textbox"), "anna.zwei@example.com");
    await userEvent.click(send);
    await screen.findByRole("alertdialog", { name: OWN_WORD });
    expect(order).toStrictEqual(["dry run", "dry run", "touch", "act"]);
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
