import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";

import SpielplanPage, { generateMetadata } from "./page";

import type { ResolvingMetadata } from "next";

/** Each season the Spielplan was read for, so a case can tell that none was. */
const reads = vi.hoisted((): string[] => []);

vi.mock("@/features/saisons/queries", () => ({
  // The seasons the public may read: 2027 alone.
  getSaisonFrame: async () => ({ saisons: [{ id: "2027" }], active_saison_id: "2027" }),
  getSpielplan: async (saison: string) => {
    reads.push(saison);
    return null;
  },
}));

describe("a season the public cannot read", () => {
  // Unknown, malformed or withheld alike: the page's title and canonical would name a Spielplan the page does not show.
  it.each(["2099", "abcd"])("answers %s as not-found in the metadata and the page, reading no Spielplan", async (saison) => {
    reads.length = 0;
    const params = Promise.resolve({ saison });

    // Titled as not found rather than thrown: a throw from the metadata leaves the tab the layout's title.
    await expect(
      generateMetadata({ params, searchParams: Promise.resolve({}) }, Promise.resolve({}) as unknown as ResolvingMetadata),
    ).resolves.toBe(NOT_FOUND_METADATA);
    const stream = await renderToReadableStream(
      <SpielplanPage
        params={params}
        searchParams={Promise.resolve({})}
      />,
      { onError: () => undefined },
    );
    await stream.allReady;
    expect(reads).toStrictEqual([]);
  });
});
