import { describe, expect, it } from "vitest";

import { ROUTES } from "@/core/routes.ts";

import { pageMetadata } from "./metadata.ts";

import type { ResolvedMetadata, ResolvingMetadata } from "next";

/** The image the root's file convention resolves to, as Next hands it to a page through `parent`. */
const SHARE_IMAGE = { url: "https://frankfurtleague.de/opengraph-image.png?a1b2c3", width: 1200, height: 630, type: "image/png" };

// Only `openGraph` is read off the parent, so the rest of its resolved shape is left out.
const parent: ResolvingMetadata = Promise.resolve({ openGraph: { images: [SHARE_IMAGE] } } as unknown as ResolvedMetadata);

describe("a page's own preview", () => {
  // Next replaces the parent's whole `openGraph` once a page declares one, so an image left behind there
  // reaches no page and every shared link previews as a bare address, with nothing failing.
  it("keeps the image the root's file convention set", async () => {
    const { openGraph } = await pageMetadata(parent, ROUTES.about, ROUTES.about.path());
    expect(openGraph).toMatchObject({ url: "/about", images: [SHARE_IMAGE] });
  });
});

describe("a page's canonical", () => {
  it("names the address of a page search engines list", async () => {
    const { alternates, robots } = await pageMetadata(parent, ROUTES.about, ROUTES.about.path());
    expect(alternates).toEqual({ canonical: "/about" });
    expect(robots).toBeUndefined();
  });

  // A canonical names the address to list; on a page kept out of the index it says the opposite of its noindex.
  it("is left off a page kept out of the index", async () => {
    const { alternates, robots } = await pageMetadata(parent, ROUTES.signIn, ROUTES.signIn.path());
    expect(alternates).toBeUndefined();
    expect(robots).toEqual({ index: false, follow: false });
  });
});
