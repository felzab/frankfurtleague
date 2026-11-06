// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { TURNSTILE_FIELD } from "@/core/turnstileToken";

import { OneShotForm } from "./OneShot";

import type { ActionAnswer } from "@/core/action";
import type { EndState } from "./OneShot";

const check = vi.hoisted(() => ({ take: vi.fn() }));

vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), useRouter: () => ({ refresh: () => {} }) }));
vi.mock("./useBotCheck", () => ({ useBotCheck: () => ({ widget: null, takeToken: check.take }) }));

const REFUSED: ActionAnswer<EndState> = { ok: false, reason: COPY.shared.failure.tooManyAttempts };

const form = (action: (formData: FormData) => Promise<ActionAnswer<EndState>>) => (
  <OneShotForm
    head={<h1>{COPY.shared.help}</h1>}
    action={action}
    acts={{ primary: COPY.shared.verb.next }}
    botCheck={{ siteKey: "key" }}
    replayField="replay"
  />
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
    expect(screen.getByRole("status").textContent).toBe(COPY.shared.botCheck);
  });

  // The harm: a second press carrying a new key, after an answer lost on its way, stores a second application.
  it("posts each press's token, and one replay key over every press", async () => {
    check.take.mockResolvedValueOnce({ token: "first" }).mockResolvedValueOnce({ token: "second" });
    const action = vi.fn<(formData: FormData) => Promise<ActionAnswer<EndState>>>(async () => REFUSED);
    render(form(action));

    await press();
    await press();

    const [first, second] = action.mock.calls.map(([sent]) => sent);
    expect([first?.get(TURNSTILE_FIELD), second?.get(TURNSTILE_FIELD)]).toStrictEqual(["first", "second"]);
    expect(first?.get("replay")).toBe(second?.get("replay"));
    expect(first?.get("replay")).toBeTruthy();
  });
});
