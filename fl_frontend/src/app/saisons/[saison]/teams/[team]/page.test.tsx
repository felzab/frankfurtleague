import { describe, expect, it } from "vitest";

import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";
import { serveBackend } from "@/test-support/backend";
import { doubleNextRequest } from "@/test-support/nextRequest";

import type { FLSaisonFrameResponse } from "@/core/generated/client/types";

/** The seasons the public may read: 2027 alone. */
const FRAME = {
  saisons: [{ id: "2027", start_date: "2026-09-01", end_date: "2027-06-30" }],
  active_saison_id: "2027",
} satisfies FLSaisonFrameResponse;

// The frame alone; a read of any club goes unanswered, which fails the case.
const backend = serveBackend(({ method, path }) => (method === "GET" && path === "/saisons/frame" ? FRAME : undefined));
// The cached reads declare their tag and lifetime through `next/cache`, which answers only inside Next's cache scope.
doubleNextRequest();

const { generateMetadata } = await import("./page");

describe("the club page's server render", () => {
  // The backend answers a malformed id as a route it does not know, which the read takes for a failure: the page
  // would show the error page, and every such address would key a cache entry of its own.
  it("answers a malformed club id as not-found before any read", async () => {
    const metadata = generateMetadata({ params: Promise.resolve({ saison: "2027", team: "not-an-id" }), searchParams: Promise.resolve({}) });

    // Titled as not found rather than thrown: a throw from the metadata leaves the tab the layout's title.
    await expect(metadata).resolves.toBe(NOT_FOUND_METADATA);
    expect(backend.sent.filter(({ path }) => path.includes("/teams/"))).toStrictEqual([]);
  });
});
