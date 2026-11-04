import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SERVER_COPY } from "@/core/serverCopy";

import HomePage from "./page";

import type { FLLandingResponse } from "@/core/generated/client/types";
import type { ComponentProps } from "react";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("next/server", async (original) => ({ ...(await original<object>()), connection: async () => undefined }));

/** The landing's read each case serves: no season yet, and the window a case sets. */
const landing = vi.hoisted((): { current: FLLandingResponse } => ({ current: { saison: null, bewerbung_window: null } }));

vi.mock("./landing", async (original) => ({ ...(await original<object>()), readLanding: async () => landing.current }));

/** The landing's whole server render for the window given: the document a browser shows before hydrating. */
async function rendered(window: FLLandingResponse["bewerbung_window"]) {
  landing.current = { saison: null, bewerbung_window: window };
  const stream = await renderToReadableStream(<HomePage />);
  await stream.allReady;
  return new Response(stream).text();
}

/** Every address the render links, by its `href`. */
const hrefs = (html: string): string[] =>
  [...html.matchAll(/<a[^>]*href="([^"]+)"/g)].flatMap(([, href]) => (href === undefined ? [] : [href]));

const words = SERVER_COPY.landing;

// The ways to apply stand only while a window is open: a door hidden while one is open loses applications in
// silence, and one shown while none is leads a school to a form that refuses it.
describe("the landing's ways to apply", () => {
  it("lead to the form from the hero, the steps' band, the season card and the school's door while a window is open", async () => {
    const html = await rendered({ saison_id: "2028", bis: "2028-01-31" });
    expect(hrefs(html).filter((href) => href === "/bewerbung/2028")).toHaveLength(4);
    // About stays the organisers' way on alone.
    expect(hrefs(html).filter((href) => href === "/about")).toHaveLength(1);
    expect(html).toContain(words.doors.school.title);
    expect(html).toContain(words.join.opened);
    expect(html).not.toContain(words.join.closed);
  });

  it("stand nowhere while no window is open, the hero's second act leading to About", async () => {
    const html = await rendered(null);
    expect(hrefs(html).filter((href) => href.startsWith("/bewerbung"))).toStrictEqual([]);
    expect(html).not.toContain(words.doors.school.title);
    expect(html).toContain(words.join.closed);
    // The hero's second act and the steps' band lead to About, beside the organisers' way on.
    expect(hrefs(html).filter((href) => href === "/about")).toHaveLength(3);
  });
});
