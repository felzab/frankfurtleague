// @vitest-environment jsdom
import { createElement as h } from "react";

import { renderToStaticMarkup } from "react-dom/server";
import { assert, describe, expect, it, vi } from "vitest";

import { SERVER_COPY } from "@/core/serverCopy";
import { underNext } from "@/test-support/nextContexts";

// Next's font loader runs only inside its own build, so each face answers empty and records what the layout asked of it.
const faces = vi.hoisted(() => {
  const face = () => vi.fn((_options: { display?: string }) => ({ className: "", variable: "", style: { fontFamily: "" } }));
  return { Anton: face(), Inter: face(), Raleway: face() };
});
vi.mock("next/font/google", () => faces);

// Next's static import, `StaticImageData`, which Vite's asset import is not: the build names the file by its bytes' hash.
const SHARE_IMAGE = { src: "/_next/static/media/share-image.0a1b2c3d.png", width: 1200, height: 630 };
vi.mock("./share-image.png", () => ({ default: SHARE_IMAGE }));

const { default: RootLayout, metadata } = await import("./layout");

/** How the layout asked each face to show. */
const DISPLAYS = Object.fromEntries(Object.entries(faces).map(([name, face]) => [name, face.mock.calls.map(([options]) => options.display)]));

describe("what every page inherits from the root layout", () => {
  // A face arriving after the first paint would be swapped in, redrawing the text set in its stand-in and moving the
  // league table's and the search's figures under the reader; `optional` uses a face only where it is there by then.
  it("draws each web face only where it has arrived by the first paint", () => {
    expect(DISPLAYS).toStrictEqual({ Anton: ["optional"], Inter: ["optional"], Raleway: ["optional"] });
  });

  // A page declaring none of these inherits the root's, so a signed-in page, a sign-in page or one a mail
  // opens would carry the league's description, or claim the landing's address, with nothing on screen showing it.
  it.each(["description", "alternates"] as const)("holds no %s of one page", (field) => {
    expect(metadata[field]).toBeUndefined();
  });

  // An address here would stand as og:url on every page declaring none; the image is every page's, its alt the
  // catalogue's.
  it("carries the share image by its hashed address and leaves the preview's address to each page", () => {
    expect(metadata.openGraph).toHaveProperty("images", [
      { url: SHARE_IMAGE.src, width: SHARE_IMAGE.width, height: SHARE_IMAGE.height, alt: SERVER_COPY.shareImage.alt },
    ]);
    expect(metadata.openGraph).not.toHaveProperty("url");
  });

  // Without the link, or with its element anywhere but last, a slow device paints a page in pieces, and a table's column
  // widens under the reader as its later rows arrive; every test and the build still pass.
  it("holds the first paint until the body's last element is parsed", () => {
    const html = renderToStaticMarkup(
      underNext(h(RootLayout, { params: Promise.resolve({}), modal: h("aside"), children: h("main", null, h("p", null, "Absatz")) })),
    );
    const parsed = new DOMParser().parseFromString(html, "text/html");

    const link = parsed.head.querySelector('link[rel="expect"][blocking="render"]');
    assert(link !== null, "the head holds no render-blocking expect link");
    const href = link.getAttribute("href") ?? "";
    expect(href, "the link names an element of the document by its fragment").toMatch(/^#./);
    expect(parsed.body.lastElementChild?.id, "the element the link names is the body's last").toBe(href.slice(1));
  });
});
