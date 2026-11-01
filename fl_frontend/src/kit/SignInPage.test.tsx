// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { SignInPage } from "./SignInPage";

import type { Copy } from "@/core/copy";

const WORTE = COPY.anmeldung;

const ADRESSE = "lena@example.com";

describe("the sign-in template", () => {
  it("reserves no line under the address field", () => {
    render(
      <SignInPage
        view="adresse"
        titel={WORTE.title}
        row={null}
        adresse={{ label: WORTE.address, value: "", onChange: () => undefined }}
        check={null}
        send={{ label: WORTE.sendCode, onPress: () => undefined }}
        or={WORTE.or}
        passkey={{ label: WORTE.withPasskey, onPress: () => undefined }}
      />,
    );

    // Label and field alone: no empty line holds a place under the field.
    const field = screen.getByRole("textbox", { name: WORTE.address });
    expect(field.parentElement?.children).toHaveLength(2);
    expect(field.parentElement?.lastElementChild).toBe(field);
  });

  it("moves the focus to the address field on each of the server's refusals, so a screen reader reads it", () => {
    const adresseView = (error: Readonly<Record<string, Copy>> | undefined) => (
      <SignInPage
        view="adresse"
        titel={WORTE.title}
        row={null}
        adresse={{ label: WORTE.address, value: "", onChange: () => undefined, error }}
        check={null}
        send={{ label: WORTE.sendCode, onPress: () => undefined }}
        or={WORTE.or}
        passkey={{ label: WORTE.withPasskey, onPress: () => undefined }}
      />
    );
    const refusal = COPY.shared.field.format(COPY.shared.field.exampleAddress);
    const { rerender } = render(adresseView(undefined));
    const field = screen.getByRole("textbox", { name: WORTE.address });
    const send = screen.getByRole("button", { name: WORTE.sendCode });
    expect(document.activeElement).not.toBe(field);

    rerender(adresseView({ email: refusal }));
    expect(document.activeElement).toBe(field);

    // The same words again, pressed from the button: a new refusal all the same.
    send.focus();
    rerender(adresseView({ email: refusal }));
    expect(document.activeElement).toBe(field);
  });

  it("marks the address inside the code view's sentence", () => {
    render(
      <SignInPage
        view="code"
        titel={WORTE.inbox}
        row={null}
        satz={WORTE.codeOnItsWay}
        adresse={ADRESSE}
        code={{ label: WORTE.code, attempt: 0, isDisabled: false, onComplete: () => undefined }}
        back={{ label: WORTE.otherAddress, onPress: () => undefined }}
      />,
    );

    const marked = screen.getByText(ADRESSE);
    expect(marked.tagName).toBe("STRONG");
    expect(marked.parentElement?.textContent).toBe(`${WORTE.codeOnItsWay.before} ${ADRESSE} ${WORTE.codeOnItsWay.after}`);
  });

  it("marks the address wherever a view names it, inside the signed-in sentence and on a passkey view's own line", () => {
    const { unmount } = render(
      <SignInPage
        view="angemeldet"
        titel={WORTE.title}
        row={null}
        satz={WORTE.signedInAs}
        adresse={ADRESSE}
        continue={{ label: COPY.shared.uebersicht, href: "/" }}
        signOut={{ label: COPY.shared.verb.signOut, onPress: () => undefined }}
      />,
    );
    const marked = screen.getByText(ADRESSE);
    expect(marked.tagName).toBe("STRONG");
    expect(marked.parentElement?.textContent).toBe(`${WORTE.signedInAs.before} ${ADRESSE} ${WORTE.signedInAs.after}`);
    unmount();

    render(
      <SignInPage
        view="passkey"
        titel={WORTE.passkey.signIn.title}
        row={null}
        satz={WORTE.passkey.signIn.sentence}
        adresse={ADRESSE}
        los={{ label: WORTE.passkey.signIn.button, onPress: () => undefined }}
      />,
    );
    expect(screen.getByText(ADRESSE).tagName).toBe("STRONG");
  });
});
