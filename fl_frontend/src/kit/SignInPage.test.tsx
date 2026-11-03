// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { SignInPage } from "./SignInPage";

import type { Copy } from "@/core/copy";

const WORDS = COPY.signIn;

const ADDRESS = "lena@example.com";

describe("the sign-in template", () => {
  it("reserves no line under the address field", () => {
    render(
      <SignInPage
        view="address"
        title={WORDS.title}
        row={null}
        address={{ label: WORDS.address, value: "", onChange: () => undefined }}
        check={null}
        send={{ label: WORDS.sendCode, onPress: () => undefined }}
        or={WORDS.or}
        passkey={{ label: WORDS.withPasskey, onPress: () => undefined }}
      />,
    );

    // Label and field alone: no empty line holds a place under the field.
    const field = screen.getByRole("textbox", { name: WORDS.address });
    expect(field.parentElement?.children).toHaveLength(2);
    expect(field.parentElement?.lastElementChild).toBe(field);
  });

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

  it("marks the address inside the code view's sentence", () => {
    render(
      <SignInPage
        view="code"
        title={WORDS.inbox}
        row={null}
        sentence={WORDS.codeOnItsWay}
        address={ADDRESS}
        code={{ label: WORDS.code, error: null, attempt: 0, isDisabled: false, onComplete: () => undefined }}
        back={{ label: WORDS.otherAddress, onPress: () => undefined }}
      />,
    );

    const marked = screen.getByText(ADDRESS);
    expect(marked.tagName).toBe("STRONG");
    expect(marked.parentElement?.textContent).toBe(`${WORDS.codeOnItsWay.before} ${ADDRESS} ${WORDS.codeOnItsWay.after}`);
  });

  it("marks the address wherever a view names it, inside the signed-in sentence and on a passkey view's own line", () => {
    const { unmount } = render(
      <SignInPage
        view="signedIn"
        title={WORDS.title}
        row={null}
        sentence={WORDS.signedInAs}
        address={ADDRESS}
        continue={{ label: COPY.shared.overview, href: "/" }}
        signOut={{ label: COPY.shared.verb.signOut, onPress: () => undefined }}
      />,
    );
    const marked = screen.getByText(ADDRESS);
    expect(marked.tagName).toBe("STRONG");
    expect(marked.parentElement?.textContent).toBe(`${WORDS.signedInAs.before} ${ADDRESS} ${WORDS.signedInAs.after}`);
    unmount();

    render(
      <SignInPage
        view="passkey"
        title={WORDS.passkey.signIn.title}
        row={null}
        sentence={WORDS.passkey.signIn.sentence}
        address={ADDRESS}
        go={{ label: WORDS.passkey.signIn.button, onPress: () => undefined }}
      />,
    );
    expect(screen.getByText(ADDRESS).tagName).toBe("STRONG");
  });
});
