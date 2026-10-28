// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { handleSignIn } from "../../actions";
import { SignInFlow } from "./SignInFlow";

// The server action, the bot check and the passkey client each reach a service; the send alone is driven here.
vi.mock("../../actions", () => ({ handleSignIn: vi.fn() }));
vi.mock("@/shared/hooks/useTurnstile", () => ({
  useTurnstile: () => ({ widget: null, takeToken: () => Promise.resolve({ token: "token" }) }),
}));
vi.mock("@/core/authClient", () => ({ authClient: {} }));

describe("the sign-in's send", () => {
  it("moves the focus to the address field on each refusal of a malformed address, the same words twice included", async () => {
    vi.mocked(handleSignIn).mockResolvedValue({ success: false, error: "", fieldErrors: { email: "malformed" } });
    render(
      <SignInFlow
        next="/"
        siteKey=""
      />,
    );
    const field = screen.getByRole("textbox", { name: COPY.anmeldung.adresse });
    const send = screen.getByRole("button", { name: COPY.anmeldung.codeSenden });

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
});
