import { describe, expect, it, vi } from "vitest";

// Next's font loader runs only inside its own build; nothing asserted here is decided by a face.
vi.mock("next/font/google", () => {
  const face = () => ({ className: "", variable: "", style: { fontFamily: "" } });
  return { Anton: face, Inter: face, Raleway: face };
});

const { metadata } = await import("./layout.tsx");

describe("what every page inherits from the root layout", () => {
  // A page declaring none of these inherits the root's, so a signed-in page, a sign-in page or one a mail
  // opens would carry the league's description, or claim the landing's address, with nothing on screen showing it.
  it.each(["description", "alternates"] as const)("holds no %s of one page", (field) => {
    expect(metadata[field]).toBeUndefined();
  });

  // Next adds `opengraph-image.tsx`'s image only where the segment's own `openGraph` names no image, and an address here
  // would stand as og:url on every page declaring none.
  it("leaves the preview's image to the file convention and its address to each page", () => {
    expect(metadata.openGraph).not.toHaveProperty("images");
    expect(metadata.openGraph).not.toHaveProperty("url");
  });
});
