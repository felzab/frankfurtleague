// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { ClassicPage } from "./ClassicPage";
import { SignInPage } from "./SignInPage";

const WORTE = COPY.anmeldung;

/** The first screen under the classic header, whose height the classic frame declares. */
const FILLS_SCREEN = "min-h-[calc(100dvh-var(--classic-header))]";

describe("the classic page's column", () => {
  it("fills the first screen under the header at either width, so the footer starts just below it", () => {
    const { rerender } = render(<ClassicPage width="card">{null}</ClassicPage>);
    expect(screen.getByRole("main").className.split(" ")).toContain(FILLS_SCREEN);

    rerender(<ClassicPage width="form">{null}</ClassicPage>);
    expect(screen.getByRole("main").className.split(" ")).toContain(FILLS_SCREEN);
  });
});

describe("the sign-in template", () => {
  it("fills the first screen, so the footer starts just below it", () => {
    render(
      <SignInPage
        view="passkey"
        titel={WORTE.passkey.anmelden.titel}
        zeile={null}
        satz={WORTE.passkey.anmelden.satz}
        adresse="lena@example.com"
        los={{ label: WORTE.passkey.anmelden.knopf, onPress: () => undefined }}
      />,
    );

    expect(screen.getByRole("main").className.split(" ")).toContain(FILLS_SCREEN);
  });
});
