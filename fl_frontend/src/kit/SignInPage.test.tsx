// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PUBLIC_COPY } from "@/core/copy/public";
import { COPY } from "@/core/copy/shared";

import { SignInPage } from "./SignInPage";

import type { Copy } from "@/core/copy";

const WORDS = PUBLIC_COPY.signIn;

describe("the sign-in template", () => {
  it("moves the focus to the address field on each of the server's refusals, so a screen reader reads it", () => {
    const addressView = (error: Readonly<Record<string, Copy>> | undefined) => (
      <SignInPage
        view="address"
        title={COPY.page.signIn}
        row={null}
        address={{ label: COPY.shared.emailAddress, value: "", onChange: () => undefined, error }}
        check={null}
        send={{ label: WORDS.sendCode, onPress: () => undefined }}
        or={WORDS.or}
        passkey={{ label: WORDS.withPasskey, onPress: () => undefined }}
      />
    );
    const refusal = COPY.shared.field.format(COPY.shared.field.exampleAddress);
    const { rerender } = render(addressView(undefined));
    const field = screen.getByRole("textbox", { name: COPY.shared.emailAddress });
    const send = screen.getByRole("button", { name: WORDS.sendCode });
    expect(document.activeElement).not.toBe(field);

    rerender(addressView({ email: refusal }));
    expect(document.activeElement).toBe(field);

    // The same words again, pressed from the button: a new refusal all the same.
    send.focus();
    rerender(addressView({ email: refusal }));
    expect(document.activeElement).toBe(field);
  });

  /* The harm: a sign-in opened anywhere but the administration offers a person a passkey they cannot hold, under an
     „oder“ that leads nowhere, or draws the „oder“ line's two hairlines under the form with nothing after them. */
  it.each([
    ["nor the „oder“", {}],
    ["though it hands the „oder“", { or: WORDS.or }],
  ])("draws nothing between the form and its status line where the page hands no passkey, %s", (_, hand) => {
    const { container } = render(
      <SignInPage
        view="address"
        title={COPY.page.signIn}
        row={null}
        address={{ label: COPY.shared.emailAddress, value: "", onChange: () => undefined }}
        check={null}
        send={{ label: WORDS.sendCode, onPress: () => undefined }}
        {...hand}
      />,
    );

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toStrictEqual([WORDS.sendCode]);
    // The divider is decoration, hidden from every query by role or by text, so it is read by its place.
    expect(container.querySelector("form")?.nextElementSibling, "a line stands under the form").toBe(screen.getByRole("status"));
  });
});
