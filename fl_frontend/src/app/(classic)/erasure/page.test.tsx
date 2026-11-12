import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { generateMetadata } from "./page";

import type { ResolvingMetadata } from "next";

vi.mock("@/core/mailedLink", () => ({ mailedLinkToken: async () => null }));
vi.mock("@/core/auth/accounts", () => ({ erasureLinkStands: async () => false }));
vi.mock("@/core/auth/guards", () => ({ getAccountSession: async () => null }));
vi.mock("@/core/auth/passkeys", () => ({ passkeysOf: async () => [] }));
vi.mock("@/core/auth/session", () => ({ readRequestSession: async () => null }));
vi.mock("@/core/subject", () => ({ getSubjectSession: async () => null }));
vi.mock("@/features/account/personActions", () => ({ eraseAccount: async () => undefined }));
vi.mock("@/features/account/queries", () => ({ getErasureView: async () => null }));

// The harm: a tab offering a deletion over a page saying the link is dead, which no reading of the page meets.
describe("the tab's title", () => {
  it("says the link is dead where the page does", async () => {
    const parent = Promise.resolve({}) as unknown as ResolvingMetadata;

    expect((await generateMetadata(undefined, parent)).title).toBe(COPY.template.linkInvalid);
  });
});
