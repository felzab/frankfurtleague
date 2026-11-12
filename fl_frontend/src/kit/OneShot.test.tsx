// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { TURNSTILE_FIELD } from "@/core/turnstileToken";

import { OneShotForm } from "./OneShot";
import { TextField } from "./TextField";

import type { ActionAnswer } from "@/core/action";
import type { ReactNode } from "react";
import type { EndState, OneShotActs } from "./OneShot";

const check = vi.hoisted(() => ({ take: vi.fn() }));

vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), useRouter: () => ({ refresh: () => {} }) }));
vi.mock("./useBotCheck", () => ({ useBotCheck: () => ({ widget: null, takeToken: check.take }) }));

const REFUSED: ActionAnswer<EndState> = { ok: false, reason: COPY.shared.failure.tooManyAttempts };

const form = (action: (formData: FormData) => Promise<ActionAnswer<EndState>>, fields?: ReactNode) => (
  <OneShotForm
    head={<h1>{COPY.shared.help}</h1>}
    action={action}
    acts={{ primary: COPY.shared.verb.next }}
    botCheck={{ siteKey: "key" }}
    replayField="replay">
    {fields}
  </OneShotForm>
);

const press = () => act(async () => void fireEvent.click(screen.getByRole("button", { name: COPY.shared.verb.next })));

describe("a form anybody may send", () => {
  // The harm: a press with no token is refused on the server in words that tell the visitor nothing they can do.
  it("sends nothing while the check holds no token, and says the check's own sentence", async () => {
    check.take.mockResolvedValueOnce({ sentence: COPY.shared.botCheck });
    const action = vi.fn(async () => REFUSED);
    render(form(action));

    await press();

    expect(action).not.toHaveBeenCalled();
    expect(screen.getByText(COPY.shared.botCheck)).toBeTruthy();
  });

  // The harm: a retry carrying a new key, after an answer lost on its way, stores a second application; an edit sent
  // under the old key is answered as the press before it, the edit stored nowhere and nothing on the page saying so.
  it("posts each press's token, the last press's key on a retry, and a new key once a field changed", async () => {
    check.take.mockResolvedValueOnce({ token: "first" }).mockResolvedValueOnce({ token: "second" }).mockResolvedValueOnce({ token: "third" });
    const action = vi.fn<(formData: FormData) => Promise<ActionAnswer<EndState>>>(async () => REFUSED);
    render(
      form(
        action,
        <TextField
          label={COPY.shared.firstName}
          name="first_name"
          kind="text"
        />,
      ),
    );

    await press();
    await press();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Mia" } });
    await press();

    const [first, retry, edited] = action.mock.calls.map(([sent]) => sent);
    expect([first, retry, edited].map((sent) => sent?.get(TURNSTILE_FIELD))).toStrictEqual(["first", "second", "third"]);
    expect(first?.get("replay")).toBeTruthy();
    expect(retry?.get("replay")).toBe(first?.get("replay"));
    expect(edited?.get("replay")).toBeTruthy();
    expect(edited?.get("replay")).not.toBe(first?.get("replay"));
  });
});

const REFUSAL = { verb: "oppose", subject: COPY.shared.entry, consequence: COPY.admin.addressChange.previousStays } as const;
const QUESTION = COPY.shared.question(REFUSAL.subject, REFUSAL.verb);
const OPPOSE = COPY.shared.verb.oppose;

const refusalForm = (action: (formData: FormData) => Promise<ActionAnswer<EndState>>, acts: OneShotActs) => (
  <OneShotForm
    head={<h1>{COPY.shared.help}</h1>}
    action={action}
    acts={acts}
  />
);

/** The question's own press, the red one inside it. */
const confirmIn = async () => within(await screen.findByRole("alertdialog", { name: QUESTION })).getByRole("button", { name: OPPOSE });

// The harm: a refusal ends what the link offered, the entry deleted, on one stray press.
describe("a mailed page's refusal", () => {
  it("asks before it posts, posting nothing when the question closes unanswered", async () => {
    const action = vi.fn<(formData: FormData) => Promise<ActionAnswer<EndState>>>(async () => REFUSED);
    render(refusalForm(action, { primary: COPY.page.entryConfirmation, refusal: REFUSAL }));
    const refusal = screen.getByRole("button", { name: OPPOSE });

    await userEvent.click(refusal);
    await userEvent.click(within(await screen.findByRole("alertdialog", { name: QUESTION })).getByRole("button", { name: COPY.shared.back }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBe(null));

    await userEvent.click(refusal);
    await screen.findByRole("alertdialog", { name: QUESTION });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBe(null));
    expect(action).not.toHaveBeenCalled();

    await userEvent.click(refusal);
    await userEvent.click(await confirmIn());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action.mock.calls[0]?.[0].get("act")).toBe("secondary");
  });

  it("asks as the page's one act too, and posts as its main act", async () => {
    const action = vi.fn<(formData: FormData) => Promise<ActionAnswer<EndState>>>(async () => REFUSED);
    render(refusalForm(action, { refusal: REFUSAL }));

    await userEvent.click(screen.getByRole("button", { name: OPPOSE }));
    expect(action).not.toHaveBeenCalled();
    await userEvent.click(await confirmIn());

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action.mock.calls[0]?.[0].get("act")).toBe("primary");
  });
});
