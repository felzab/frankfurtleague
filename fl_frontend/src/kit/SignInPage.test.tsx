// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { ClassicPage } from "./ClassicPage";
import { SignInPage } from "./SignInPage";

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

  it("sets the address view's title in the page's column, the heading gap above the field, and reserves no line under it", () => {
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

    const main = screen.getByRole("main");
    // The title is the column's own child, 24 px above the rest as on every classic page; the rest 16 px apart.
    expect(main.firstElementChild).toBe(screen.getByRole("heading", { level: 1 }));
    expect(classesOf(main)).toContain("gap-6");
    expect(classesOf(main.lastElementChild)).toContain("gap-4");
    // Label and field alone: no empty line holds a place under the field.
    const field = screen.getByRole("textbox", { name: WORTE.adresse });
    expect(field.parentElement?.children).toHaveLength(2);
    expect(field.parentElement?.lastElementChild).toBe(field);
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

    const sentence = screen.getByRole("status").querySelector("p");
    expect(sentence?.textContent).toBe(`${WORTE.codeUnterwegs.vor} ${ADRESSE} ${WORTE.codeUnterwegs.nach}`);
    const marked = sentence?.querySelector("strong");
    expect(marked?.textContent).toBe(ADRESSE);
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
