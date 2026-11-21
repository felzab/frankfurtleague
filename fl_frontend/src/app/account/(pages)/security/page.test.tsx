// @vitest-environment jsdom
import { prerender } from "react-dom/static";
import { describe, expect, it } from "vitest";

import { ACCOUNT_COPY } from "@/core/copy/account";
import { COPY } from "@/core/copy/shared";
import { serveBackend } from "@/test-support/backend";
import { underNext } from "@/test-support/nextContexts";
import { signedInRequest } from "@/test-support/session";

// The page reads the sign-in store alone, past the guards' own lookups: any backend request fails the case.
serveBackend();
// The administrator, signed in by passkey just now, which leaves them holding the one passkey that session was made by.
const { arriveAs } = signedInRequest();

const { default: AccountSecurityPage } = await import("./page");

/** The page as the visitor signed in gets it, drawn on the server. */
async function drawn(): Promise<HTMLElement> {
  const { prelude } = await prerender(underNext(<AccountSecurityPage />, { pathname: "/account/security" }), {
    progressiveChunkSize: Number.MAX_SAFE_INTEGER,
  });
  const page = document.createElement("div");
  page.innerHTML = await new Response(prelude).text();
  return page;
}

/** Each box's title, in the order the page draws them. */
const titlesOf = (page: HTMLElement) => [...page.querySelectorAll("main section h2")].map((title) => title.textContent);

/** The reason a locked button names for its press, which the button's description points to. */
const lockedReasonOf = (page: HTMLElement, label: string): string | null | undefined => {
  const button = [...page.querySelectorAll("button")].find((candidate) => candidate.getAttribute("aria-label") === label);
  const reason = button?.getAttribute("aria-describedby");
  return reason === null || reason === undefined ? undefined : page.querySelector(`[id="${reason}"]`)?.textContent;
};

// The harm: a wrong condition takes an administrator's set-up or their last passkey's lock away, or shows a person a
// box for passkeys they cannot hold, and no journey opens the page.
describe("Sicherheit", () => {
  it("draws an administrator's passkey, its set-up, and its removal locked as the last one", async () => {
    const page = await drawn();

    expect(titlesOf(page)).toStrictEqual([COPY.shared.passkeys, ACCOUNT_COPY.devices.title]);
    const setUp = [...page.querySelectorAll("button")].find(
      (button) => button.textContent === COPY.shared.withObject(COPY.shared.passkey, "setUp"),
    );
    expect(setUp?.getAttribute("aria-disabled"), "the set-up was not offered, or offered locked").toBe(null);
    expect(lockedReasonOf(page, COPY.shared.verb.delete)).toBe(ACCOUNT_COPY.passkeys.lastKeptLocked);
  });

  it("draws a person's devices alone", async () => {
    await arriveAs({ email: "pia@example.org" });

    expect(titlesOf(await drawn())).toStrictEqual([ACCOUNT_COPY.devices.title]);
  });
});
