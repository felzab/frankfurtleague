import { serveBackend } from "@/test-support/backend.ts";
import { doubleNextRequest } from "@/test-support/nextRequest.ts";
import { describe, expect, it, vi } from "vitest";

import { ROUTES } from "@/core/routes";

import type { FLSaisonFrameResponse } from "@/core/generated/client/types";

/** The season the site is on, which each case sets. */
let active: string | null = null;

vi.mock("next/server", () => ({ connection: async () => undefined }));
// The season pages' frame alone: any other read goes unanswered, which fails the case.
serveBackend(({ method, path }) =>
  method === "GET" && path === "/saisons/frame" ? ({ saisons: [], active_saison_id: active } satisfies FLSaisonFrameResponse) : undefined,
);
// The frame is a cached read, which declares its tag and lifetime through `next/cache`, answering only in Next's cache scope.
doubleNextRequest();

const { GET: spielplan } = await import("./route");

/** Where the handler sends the request, as Next's redirect names it in what it throws. */
async function sentTo(handler: () => Promise<never>): Promise<string> {
  const thrown: unknown = await handler().catch((error: unknown) => error);
  const digest = thrown instanceof Error && "digest" in thrown ? String(thrown.digest) : "";
  const [kind, , address] = digest.split(";");
  if (kind !== "NEXT_REDIRECT" || address === undefined) throw thrown;
  return address;
}

// The harm: every address naming no season answers through one redirect, and a throw on a league without a season is
// an error page where the landing was meant.
describe("an address naming no season", () => {
  it("leads to the landing while the league has no season", async () => {
    active = null;
    expect(await sentTo(spielplan)).toBe(ROUTES.home.path());
  });
});
