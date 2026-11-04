// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { handleSignIn } from "../../actions";
import { SignInFlow } from "./SignInFlow";

// The server action, the bot check and the sign-in's client each reach a service; the send and the code's answers
// alone are driven here.
const { emailOtp } = vi.hoisted(() => ({ emailOtp: vi.fn() }));
vi.mock("../../actions", () => ({ handleSignIn: vi.fn() }));
vi.mock("@/shared/hooks/useTurnstile", () => ({
  useTurnstile: () => ({ widget: null, takeToken: () => Promise.resolve({ token: "token" }) }),
}));
vi.mock("@/core/authClient", () => ({ authClient: { signIn: { emailOtp } } }));
// A thrown send reads the page again through Next's router, which no test mounts.
vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), useRouter: () => ({ refresh: () => undefined }) }));

describe("the sign-in's send", () => {
  it("moves the focus to the address field on each refusal of a malformed address, the same words twice included", async () => {
    // A fresh answer each press, as each action's answer arrives deserialised afresh.
    vi.mocked(handleSignIn).mockImplementation(async () => ({
      ok: false,
      fieldErrors: { email: COPY.shared.field.format(COPY.shared.field.exampleAddress) },
    }));
    render(
      <SignInFlow
        next="/"
        siteKey=""
      />,
    );
    const field = screen.getByRole("textbox", { name: COPY.signIn.address });
    const send = screen.getByRole("button", { name: COPY.signIn.sendCode });

    // A new address each time: the refusal stands as the field's custom validity until it is edited, and the
    // browser keeps the send back meanwhile.
    for (const [press, address] of [
      [1, "lena@example"],
      [2, "lena@beispiel"],
    ] as const) {
      await userEvent.clear(field);
      await userEvent.type(field, address);
      await userEvent.click(send);
      await waitFor(() => expect(handleSignIn).toHaveBeenCalledTimes(press));
      await waitFor(() => expect(document.activeElement).toBe(field));
    }
  });

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

describe("the sign-in's code", () => {
  it("shows the typed code's refusal under the boxes, and every other on the status line", async () => {
    vi.mocked(handleSignIn).mockResolvedValue({ ok: true, value: "lena@example.com" });
    // The library's refusals as its client answers them: the code and the status, beside no data.
    const refused = (code: string, status: number) => ({ data: null, error: { code, status } });
    emailOtp.mockResolvedValueOnce(refused("INVALID_OTP", 400)).mockResolvedValueOnce(refused("SIGN_IN_BARRED", 403));
    render(
      <SignInFlow
        next="/"
        siteKey=""
      />,
    );
    await userEvent.type(screen.getByRole("textbox", { name: COPY.signIn.address }), "lena@example.com");
    await userEvent.click(screen.getByRole("button", { name: COPY.signIn.sendCode }));
    const code = await screen.findByRole("textbox", { name: COPY.signIn.code });

    await userEvent.type(code, "123456");
    expect((await screen.findByRole("alert")).textContent).toBe(COPY.signIn.refusal.codeWrong);
    expect(screen.queryByText(COPY.signIn.refusal.noRecord)).toBe(null);

    // An address's refusal is no fault of the typed digits: the boxes stay clear of it.
    await userEvent.type(screen.getByRole("textbox", { name: COPY.signIn.code }), "654321");
    await waitFor(() => expect(screen.getByText(COPY.signIn.refusal.noRecord)).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toBe("");
  });
});
