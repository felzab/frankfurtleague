// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { ClassicPage } from "./ClassicPage";
import { SignInPage } from "./SignInPage";

import type { Copy } from "@/core/copy";

const WORTE = COPY.anmeldung;

/** The first screen under the classic header, whose height the classic frame declares. */
const FILLS_SCREEN = "min-h-[calc(100dvh-var(--classic-header))]";

const ADRESSE = "lena@example.com";

const classesOf = (element: Element | null | undefined) => element?.className.split(" ") ?? [];

/** The quiet button: words alone, no fill and no edge. */
const QUIET = ["bg-transparent", "border-transparent", "text-fg-muted"];

describe("the classic page's column", () => {
  it("fills the first screen under the header at either width, so the footer starts just below it", () => {
    const { rerender } = render(<ClassicPage width="card">{null}</ClassicPage>);
    expect(screen.getByRole("main").className.split(" ")).toContain(FILLS_SCREEN);

    rerender(<ClassicPage width="form">{null}</ClassicPage>);
    expect(screen.getByRole("main").className.split(" ")).toContain(FILLS_SCREEN);
  });

  it("keeps the status card's width where the sign-in takes its own, narrower column", () => {
    const { rerender } = render(<ClassicPage width="card">{null}</ClassicPage>);
    expect(screen.getByRole("main").className.split(" ")).toContain("max-w-[30rem]");

    rerender(<ClassicPage width="signin">{null}</ClassicPage>);
    expect(screen.getByRole("main").className.split(" ")).toContain("max-w-[24rem]");
  });
});

describe("the sign-in template", () => {
  it("fills the first screen in the 384-px column, so the footer starts just below it", () => {
    render(
      <SignInPage
        view="passkey"
        titel={WORTE.passkey.anmelden.titel}
        zeile={null}
        satz={WORTE.passkey.anmelden.satz}
        adresse={ADRESSE}
        los={{ label: WORTE.passkey.anmelden.knopf, onPress: () => undefined }}
      />,
    );

    expect(screen.getByRole("main").className.split(" ")).toEqual(expect.arrayContaining([FILLS_SCREEN, "max-w-[24rem]"]));
  });

  it("reserves no line under the address field", () => {
    render(
      <SignInPage
        view="adresse"
        titel={WORTE.titel}
        zeile={null}
        adresse={{ label: WORTE.adresse, value: "", onChange: () => undefined }}
        pruefung={null}
        senden={{ label: WORTE.codeSenden, onPress: () => undefined }}
        oder={WORTE.oder}
        passkey={{ label: WORTE.mitPasskey, onPress: () => undefined }}
      />,
    );

    // Label and field alone: no empty line holds a place under the field.
    const field = screen.getByRole("textbox", { name: WORTE.adresse });
    expect(field.parentElement?.children).toHaveLength(2);
    expect(field.parentElement?.lastElementChild).toBe(field);
  });

  it("moves the focus to the address field on each of the server's refusals, so a screen reader reads it", () => {
    const adresseView = (fehler: Readonly<Record<string, Copy>> | undefined) => (
      <SignInPage
        view="adresse"
        titel={WORTE.titel}
        zeile={null}
        adresse={{ label: WORTE.adresse, value: "", onChange: () => undefined, fehler }}
        pruefung={null}
        senden={{ label: WORTE.codeSenden, onPress: () => undefined }}
        oder={WORTE.oder}
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

  it("sets the address semibold inside the code view's sentence, and the step aside as the quiet button", () => {
    render(
      <SignInPage
        view="code"
        titel={WORTE.postfach}
        zeile={null}
        satz={WORTE.codeUnterwegs}
        adresse={ADRESSE}
        code={{ label: WORTE.code, versuch: 0, isDisabled: false, onComplete: () => undefined }}
        zurueck={{ label: WORTE.andereAdresse, onPress: () => undefined }}
      />,
    );

    const marked = screen.getByText(ADRESSE);
    expect(marked.tagName).toBe("STRONG");
    expect(marked.parentElement?.textContent).toBe(`${WORTE.codeUnterwegs.vor} ${ADRESSE} ${WORTE.codeUnterwegs.nach}`);
    expect(classesOf(marked)).toContain("font-semibold");
    expect(classesOf(screen.getByRole("button", { name: WORTE.andereAdresse }))).toEqual(expect.arrayContaining(QUIET));
  });

  it("offers signing out as the quiet button beside the way on", () => {
    render(
      <SignInPage
        view="angemeldet"
        titel={WORTE.titel}
        zeile={null}
        satz={WORTE.angemeldetAls(ADRESSE)}
        weiter={{ label: COPY.shared.uebersicht, href: "/" }}
        abmelden={{ label: COPY.shared.verb.abmelden, onPress: () => undefined }}
      />,
    );

    expect(classesOf(screen.getByRole("button", { name: COPY.shared.verb.abmelden }))).toEqual(expect.arrayContaining(QUIET));
  });
});
