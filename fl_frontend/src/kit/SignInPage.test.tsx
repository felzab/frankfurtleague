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
        titel={WORTE.titel}
        row={null}
        adresse={{ label: WORTE.adresse, value: "", onChange: () => undefined }}
        check={null}
        send={{ label: WORTE.codeSenden, onPress: () => undefined }}
        or={WORTE.oder}
        passkey={{ label: WORTE.mitPasskey, onPress: () => undefined }}
      />,
    );

    // Label and field alone: no empty line holds a place under the field.
    const field = screen.getByRole("textbox", { name: WORTE.adresse });
    expect(field.parentElement?.children).toHaveLength(2);
    expect(field.parentElement?.lastElementChild).toBe(field);
  });

  it("moves the focus to the address field on each of the server's refusals, so a screen reader reads it", () => {
    const adresseView = (error: Readonly<Record<string, Copy>> | undefined) => (
      <SignInPage
        view="adresse"
        titel={WORTE.titel}
        row={null}
        adresse={{ label: WORTE.adresse, value: "", onChange: () => undefined, error }}
        check={null}
        send={{ label: WORTE.codeSenden, onPress: () => undefined }}
        or={WORTE.oder}
        passkey={{ label: WORTE.mitPasskey, onPress: () => undefined }}
      />
    );
    const refusal = COPY.shared.feld.format(COPY.shared.feld.beispielAdresse);
    const { rerender } = render(adresseView(undefined));
    const field = screen.getByRole("textbox", { name: WORTE.adresse });
    const send = screen.getByRole("button", { name: WORTE.codeSenden });
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
        titel={WORTE.postfach}
        row={null}
        satz={WORTE.codeUnterwegs}
        adresse={ADRESSE}
        code={{ label: WORTE.code, attempt: 0, isDisabled: false, onComplete: () => undefined }}
        back={{ label: WORTE.andereAdresse, onPress: () => undefined }}
      />,
    );

    const marked = screen.getByText(ADRESSE);
    expect(marked.tagName).toBe("STRONG");
    expect(marked.parentElement?.textContent).toBe(`${WORTE.codeUnterwegs.vor} ${ADRESSE} ${WORTE.codeUnterwegs.nach}`);
  });

  it("marks the address wherever a view names it, inside the signed-in sentence and on a passkey view's own line", () => {
    const { unmount } = render(
      <SignInPage
        view="angemeldet"
        titel={WORTE.titel}
        row={null}
        satz={WORTE.angemeldetAls}
        adresse={ADRESSE}
        continue={{ label: COPY.shared.uebersicht, href: "/" }}
        signOut={{ label: COPY.shared.verb.abmelden, onPress: () => undefined }}
      />,
    );
    const marked = screen.getByText(ADRESSE);
    expect(marked.tagName).toBe("STRONG");
    expect(marked.parentElement?.textContent).toBe(`${WORTE.angemeldetAls.vor} ${ADRESSE} ${WORTE.angemeldetAls.nach}`);
    unmount();

    render(
      <SignInPage
        view="passkey"
        titel={WORTE.passkey.anmelden.titel}
        row={null}
        satz={WORTE.passkey.anmelden.satz}
        adresse={ADRESSE}
        los={{ label: WORTE.passkey.anmelden.knopf, onPress: () => undefined }}
      />,
    );
    expect(screen.getByText(ADRESSE).tagName).toBe("STRONG");
  });
});
