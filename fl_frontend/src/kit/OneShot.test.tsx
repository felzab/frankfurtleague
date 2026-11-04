// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import { OneShotEnd, OneShotForm } from "./OneShot";
import { StatusPage } from "./StatusPage";

import type { ActionAnswer } from "@/core/action";
import type * as Navigation from "next/navigation";
import type { EndState } from "./OneShot";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof Navigation>()), useRouter: () => router }));
// The touch is never asked here; its client loads nothing in a test process.
vi.mock("@/core/auth/browserClient", () => ({ loadAuthClient: vi.fn(), usePreloadedAuthClient: () => undefined }));

const WORDS = SERVER_COPY.addressChange;

/** The end the press's answer reaches: the new mailbox's confirmation, leading on to the sign-in. */
const DONE: EndState = {
  tone: "success",
  title: WORDS.new.confirmed,
  sentence: WORDS.new.confirmedSentence,
  next: { label: COPY.shared.verb.signIn, href: "/signin" },
};

/** The page as the link reads once its answer stands: another state, which takes the form's place. */
function readAgain() {
  return (
    <StatusPage
      frame="classic"
      tone="info"
      title={WORDS.new.confirmed}
      sentence={WORDS.previous.confirmedSentence}
      next={{ label: COPY.shared.end.toAccount, href: "/account/signin" }}
    />
  );
}

/* A done action renders the page again in the same response, its write having cleared the cache tag, and the link
   read again is in its opened-again state: the form the person pressed is gone from the tree before or as its
   answer arrives, and the end it reached must stand all the same. */
describe("the one-shot submit's end", () => {
  it("stands where the page's own re-render has replaced the form while the answer was on its way", async () => {
    let settle: (answer: ActionAnswer<EndState>) => void = () => undefined;
    const action = (): Promise<ActionAnswer<EndState>> =>
      new Promise((resolve) => {
        settle = resolve;
      });
    const page = (form: boolean) => (
      <OneShotEnd>
        {form ? (
          <OneShotForm
            head={<h1>{COPY.shared.withObject(COPY.signIn.address, "confirm")}</h1>}
            action={action}
            acts={{ primary: COPY.shared.verb.confirm }}
          />
        ) : (
          readAgain()
        )}
      </OneShotEnd>
    );
    const { rerender } = render(page(true));

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.confirm }));
    rerender(page(false));
    await act(async () => {
      settle({ ok: true, value: DONE });
    });

    expect(await screen.findByText(WORDS.new.confirmedSentence)).toBeTruthy();
    expect(screen.getByRole("link", { name: COPY.shared.verb.signIn }).getAttribute("href")).toBe("/signin");
    expect(screen.queryByText(WORDS.previous.confirmedSentence)).toBe(null);
  });
});
