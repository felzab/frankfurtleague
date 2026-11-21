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
    underNext(
      <SignInPage
        params={Promise.resolve({})}
        searchParams={Promise.resolve(search)}
      />,
      {
        pathname: "/signin",
        search: new URLSearchParams(search),
      },
    ),
  );

/** Each button's words, and whether the „oder“ line between the two sign-ins stands. */
const actsOf = (page: HTMLElement) => ({
  buttons: [...page.querySelectorAll("button")].map((button) => button.textContent),
  or: [...page.querySelectorAll("div")].some((line) => line.textContent === WORDS.or),
});

// The harm: only an administrator holds a passkey, so a wrong condition offers every person a button they cannot use,
// under an „oder“ leading nowhere, and no journey opens the sign-in as a person looking for it.
describe("the sign-in page", () => {
  it.each([
    ["no return address", {}],
    ["a return address outside the administration", { [RETURN_PARAMETER]: "/area" }],
    // Under the administration's prefix, yet a page no sign-in returns to: the allowlist decides, not the prefix.
    ["a return address the allowlist refuses", { [RETURN_PARAMETER]: "/admin/x.y" }],
  ])("offers the code alone for %s", async (_, search) => {
    expect(actsOf(await drawn(search))).toStrictEqual({ buttons: [WORDS.sendCode], or: false });
  });

  it("offers the passkey beside the code for a return to the administration", async () => {
    expect(actsOf(await drawn({ [RETURN_PARAMETER]: "/admin" }))).toStrictEqual({ buttons: [WORDS.sendCode, WORDS.withPasskey], or: true });
  });
});
