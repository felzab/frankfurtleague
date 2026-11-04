import { describe, expect, it, vi } from "vitest";

import PasskeyPage from "./page";

import type { ReactElement } from "react";

vi.mock("next/navigation", async (original) => ({
  ...(await original<object>()),
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
// A session the passkey step does not hold, as one that skipped the step or finished it in another tab.
vi.mock("@/core/auth/landing", () => ({ getPasskeyStep: async () => null }));

// A session skipping the step loses its mailed link's target in silence if the page leads on without it.
describe("the passkey page for a session the step does not hold", () => {
  it("leads to the landing carrying the address a mailed link asked for", async () => {
    const page = PasskeyPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({ return: "/loeschung?token=abc" }),
    }) as ReactElement<{
      view: Promise<unknown>;
    }>;
    await expect(page.props.view).rejects.toThrow("redirect /signin/continue?return=%2Floeschung%3Ftoken%3Dabc");
  });

  it("leads to the landing alone for an address the allowlist does not hold", async () => {
    const page = PasskeyPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({ return: "https://example.com/" }),
    }) as ReactElement<{
      view: Promise<unknown>;
    }>;
    await expect(page.props.view).rejects.toThrow(/^redirect \/signin\/continue$/);
  });
});
