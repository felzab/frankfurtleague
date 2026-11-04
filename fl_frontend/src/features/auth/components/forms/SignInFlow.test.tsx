// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { handleSignIn } from "../../actions";
import { SignInFlow } from "./SignInFlow";

// The server action, the bot check and the sign-in's client each reach a service; the send alone is driven here.
vi.mock("../../actions", () => ({ handleSignIn: vi.fn() }));
vi.mock("@/shared/hooks/useTurnstile", () => ({
  useTurnstile: () => ({ widget: null, takeToken: () => Promise.resolve({ token: "token" }) }),
}));
vi.mock("@/core/authClient", () => ({ authClient: { signIn: { emailOtp: vi.fn() } } }));
// A thrown send reads the page again through Next's router, which no test mounts.
vi.mock("next/navigation", async (original) => ({
  ...(await original<object>()),
  useRouter: () => ({ refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("the sign-in's send", () => {
  it("empties its status line while a send is on its way, so the same refusal twice is announced twice", async () => {
    const refusal = { ok: false, reason: COPY.shared.botCheck.confirm } as const;
    const second = Promise.withResolvers<typeof refusal>();
    vi.mocked(handleSignIn).mockResolvedValueOnce(refusal).mockReturnValueOnce(second.promise);
    render(
      <SignInFlow
        next="/"
        siteKey=""
      />,
    );
    const line = screen.getByRole("status");
    const send = screen.getByRole("button", { name: COPY.signIn.sendCode });
    await userEvent.type(screen.getByRole("textbox", { name: COPY.signIn.address }), "lena@example.com");

    await userEvent.click(send);
    await waitFor(() => expect(line.textContent).toBe(refusal.reason));

    // A polite live region speaks only where its words change.
    await userEvent.click(send);
    await waitFor(() => expect(line.textContent).toBe(""));
    await act(async () => second.resolve(refusal));
    expect(line.textContent).toBe(refusal.reason);
  });
});
