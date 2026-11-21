import { describe, expect, it, vi } from "vitest";

import { ROUTES } from "@/core/routes";

import { pageMetadata } from "./metadata";

// Next's static import, `StaticImageData`, which Vite's asset import is not: the build names the file by its bytes' hash.
const SHARE_IMAGE = vi.hoisted(() => ({ src: "/_next/static/media/share-image.0a1b2c3d.png", width: 1200, height: 630 }));
vi.mock("@/app/share-image.png", () => ({ default: SHARE_IMAGE }));

describe("a page's own preview", () => {
  // Next replaces the parent's whole `openGraph` once a page declares one, so an image left out here reaches no page
  // and every shared link previews as a bare address, with nothing failing.
  it("carries the share image", () => {
    const { openGraph } = pageMetadata(ROUTES.about);
    expect(openGraph).toMatchObject({
      url: "/about",
      images: [{ url: SHARE_IMAGE.src, width: SHARE_IMAGE.width, height: SHARE_IMAGE.height }],
    });
  });
});

describe("a page's canonical", () => {
  it("names the address of a page search engines list", () => {
    const { alternates, robots } = pageMetadata(ROUTES.about);
    expect(alternates).toEqual({ canonical: "/about" });
    expect(robots).toBeUndefined();
  });

  // A canonical names the address to list; on a page kept out of the index it says the opposite of its noindex.
  it("is left off a page kept out of the index", () => {
    const { alternates, robots } = pageMetadata(ROUTES.signIn);
    expect(alternates).toBeUndefined();
    expect(robots).toEqual({ index: false, follow: false });
  });
});
