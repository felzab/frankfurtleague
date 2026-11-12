// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { SignInPage } from "./SignInPage";

import type { Copy } from "@/core/copy";

const WORDS = COPY.signIn;

describe("the sign-in template", () => {
  it("moves the focus to the address field on each of the server's refusals, so a screen reader reads it", () => {
    const addressView = (error: Readonly<Record<string, Copy>> | undefined) => (
      <SignInPage
        view="address"
        title={WORDS.title}
        row={null}
        address={{ label: WORDS.address, value: "", onChange: () => undefined, error }}
        check={null}
        send={{ label: WORDS.sendCode, onPress: () => undefined }}
        or={WORDS.or}
        passkey={{ label: WORDS.withPasskey, onPress: () => undefined }}
      />
    );
    const refusal = COPY.shared.field.format(COPY.shared.field.exampleAddress);
    const { rerender } = render(addressView(undefined));
    const field = screen.getByRole("textbox", { name: WORDS.address });
    const send = screen.getByRole("button", { name: WORDS.sendCode });
    expect(document.activeElement).not.toBe(field);

    rerender(addressView({ email: refusal }));
    expect(document.activeElement).toBe(field);

    // The same words again, pressed from the button: a new refusal all the same.
    send.focus();
    rerender(addressView({ email: refusal }));
    expect(document.activeElement).toBe(field);
  });
});
