import { describe, expect, it, vi } from "vitest";

import { SERVER_COPY } from "@/core/serverCopy";

// Next's font loader runs only inside its own build; nothing asserted here is decided by a face.
vi.mock("next/font/google", () => {
  const face = () => ({ className: "", variable: "", style: { fontFamily: "" } });
  return { Anton: face, Inter: face, Raleway: face };
});

// Next's static import, `StaticImageData`, which Vite's asset import is not: the build names the file by its bytes' hash.
const SHARE_IMAGE = { src: "/_next/static/media/share-image.0a1b2c3d.png", width: 1200, height: 630 };
vi.mock("./share-image.png", () => ({ default: SHARE_IMAGE }));

const { metadata } = await import("./layout.tsx");

describe("what every page inherits from the root layout", () => {
  // A page declaring none of these inherits the root's, so a signed-in page, a sign-in page or one a mail
  // opens would carry the league's description, or claim the landing's address, with nothing on screen showing it.
  it.each(["description", "alternates"] as const)("holds no %s of one page", (field) => {
    expect(metadata[field]).toBeUndefined();
  });

  // An address here would stand as og:url on every page declaring none; the image is every page's, carried on by
  // `openGraphFor`, its alt the catalogue's.
  it("carries the share image by its hashed address and leaves the preview's address to each page", () => {
    expect(metadata.openGraph).toHaveProperty("images", [
      { url: SHARE_IMAGE.src, width: SHARE_IMAGE.width, height: SHARE_IMAGE.height, alt: SERVER_COPY.shareImage.alt },
    ]);
    expect(metadata.openGraph).not.toHaveProperty("url");
  });
});
