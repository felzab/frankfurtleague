// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { RETURN_PARAMETER } from "@/core/auth/returnAddress";
import { PUBLIC_COPY } from "@/core/copy/public";
import { underNext } from "@/test-support/nextContexts";
import { drawnOnServer } from "@/test-support/server";

import SignInPage from "./page";

const WORDS = PUBLIC_COPY.signIn;

/** The page as a visitor opening `/signin` with `search` gets it, drawn on the server. */
const drawn = (search: Record<string, string>): Promise<HTMLElement> =>
  drawnOnServer(
    underNext(<SignInPage />, {
      pathname: "/signin",
      search: new URLSearchParams(search),
    }),
  );

/** Each button's words, and whether the „oder“ line between the two sign-ins stands. */
const actsOf = (page: HTMLElement) => ({
  buttons: [...page.querySelectorAll("button")].map((button) => button.textContent),
  or: [...page.querySelectorAll("div")].some((line) => line.textContent === WORDS.or),
});

// The harm: while no mail leaves, the passkey is an administrator's one way in, so a sign-in that hides it for some
// address leaves them locked out, and the passkey journey opens the sign-in by one address alone.
describe("the sign-in page", () => {
  it.each([
    ["no return address", {}],
    ["a return address outside the administration", { [RETURN_PARAMETER]: "/area" }],
    ["a return to the administration", { [RETURN_PARAMETER]: "/admin" }],
  ])("offers the passkey beside the code for %s", async (_, search) => {
    expect(actsOf(await drawn(search))).toStrictEqual({ buttons: [WORDS.sendCode, WORDS.withPasskey], or: true });
  });
});
