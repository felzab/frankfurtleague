// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { TURNSTILE_FIELD } from "@/core/turnstileToken";

import { OneShotEnd, OneShotForm } from "./OneShot";
import { TextField } from "./TextField";

import type { ActionAnswer } from "@/core/action";
import type { ReactNode } from "react";
import type { EndState } from "./OneShot";

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

// The harm: the pressed act leaves with the form as the end takes its place, the focus drops on `body` and a screen
// reader says nothing of what the press did.
describe("a one-shot form's done answer", () => {
  it("hands the focus to the end's title", async () => {
    const end: EndState = { tone: "success", title: COPY.shared.saved, next: { label: COPY.shared.verb.signIn, href: "/" } };
    render(
      <OneShotEnd>
        <OneShotForm
          head={<h1>{COPY.shared.help}</h1>}
          action={async () => ({ ok: true, value: end })}
          acts={{ primary: COPY.shared.verb.next }}
        />
      </OneShotEnd>,
    );
    screen.getByRole("button", { name: COPY.shared.verb.next }).focus();

    await press();

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: COPY.shared.saved })));
  });
});

describe("a form anybody may send", () => {
  // The harm: a press with no token is refused on the server in words that tell the visitor nothing they can do.
  it("sends nothing while the check holds no token, and says the check's own sentence", async () => {
    check.take.mockResolvedValueOnce({ sentence: COPY.shared.botCheck });
    const action = vi.fn(async () => REFUSED);
    render(form(action));

    await press();

    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(COPY.shared.botCheck);
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
