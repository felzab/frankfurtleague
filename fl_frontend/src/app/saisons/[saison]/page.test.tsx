import { serveBackend } from "@/test-support/backend.ts";
import { doubleNextRequest } from "@/test-support/nextRequest.ts";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";

import type { FLSaisonFrameResponse } from "@/core/generated/client/types";
import type { ResolvingMetadata } from "next";

/** The seasons the public may read: 2027 alone. */
const FRAME = {
  saisons: [{ id: "2027", start_date: "2026-09-01", end_date: "2027-06-30" }],
  active_saison_id: "2027",
} satisfies FLSaisonFrameResponse;

// The frame alone is answered: a Spielplan read is a request nothing answers, which fails the case by itself.
const backend = serveBackend(({ method, path }) => (method === "GET" && path === "/saisons/frame" ? FRAME : undefined));
// The cached reads declare their tag and lifetime through `next/cache`, which answers only inside Next's cache scope.
doubleNextRequest();

const { default: SpielplanPage, generateMetadata } = await import("./page");

describe("a season the public cannot read", () => {
  // Unknown, malformed or withheld alike: the page's title and canonical would name a Spielplan the page does not show.
  it.each(["2099", "abcd"])("answers %s as not-found in the metadata and the page, reading no Spielplan", async (saison) => {
    const params = Promise.resolve({ saison });

    // Titled as not found rather than thrown: a throw from the metadata leaves the tab the layout's title.
    await expect(
      generateMetadata({ params, searchParams: Promise.resolve({}) }, Promise.resolve({}) as unknown as ResolvingMetadata),
    ).resolves.toBe(NOT_FOUND_METADATA);
    // The page has no boundary of its own, so its not-found ends the render before any read.
    await expect(
      renderToReadableStream(
        <SpielplanPage
          params={params}
          searchParams={Promise.resolve({})}
        />,
        { onError: () => undefined },
      ),
    ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(new Set(backend.sent.map(({ method, path }) => `${method} ${path}`))).toStrictEqual(new Set(["GET /saisons/frame"]));
  });
});
