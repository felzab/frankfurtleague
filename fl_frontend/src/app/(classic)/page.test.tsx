import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import HomePage from "./page";

import type { FLLandingResponse } from "@/core/generated/client/types";
import type { ComponentProps } from "react";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("next/server", async (original) => ({ ...(await original<object>()), connection: async () => undefined }));

/** The landing's read each case serves: no season yet, no figures, and the window a case sets. */
const landing = vi.hoisted((): { counts: FLLandingResponse["counts"]; current: FLLandingResponse | Promise<FLLandingResponse> } => {
  const counts = { count_saisons: 0, count_schulen: 0, count_spiele: 0, count_tore: 0 };
  return { counts, current: { saison: null, bewerbung_window: null, counts } };
});

vi.mock("./landing", async (original) => ({ ...(await original<object>()), readLanding: async () => landing.current }));

/** The landing's whole server render for the window given: the document a browser shows before hydrating. */
async function rendered(window: FLLandingResponse["bewerbung_window"]) {
  landing.current = { saison: null, bewerbung_window: window, counts: landing.counts };
  const stream = await renderToReadableStream(<HomePage />);
  await stream.allReady;
  return new Response(stream).text();
}

/** Every address the render links, by its `href`. */
const hrefs = (html: string): string[] =>
  [...html.matchAll(/<a[^>]*href="([^"]+)"/g)].flatMap(([, href]) => (href === undefined ? [] : [href]));

// A door to the application form hidden while a window is open loses applications in silence.
describe("the landing's ways to apply", () => {
  it("lead to the form from the hero, the steps' band, the season card and the school's door while a window is open", async () => {
    const html = await rendered({ saison_id: "2028", end: "2028-01-31" });
    expect(hrefs(html).filter((href) => href === "/bewerbung/2028")).toHaveLength(4);
  });
});

// Static sections moved behind the read would leave the wait short of the page, and a reload while scrolled would land
// the person higher than they were, which only a slow read shows.
describe("the landing while its read waits", () => {
  it("stands every static section at once", async () => {
    landing.current = new Promise(() => undefined);
    const shell = new AbortController();
    const stream = await renderToReadableStream(<HomePage />, { signal: shell.signal, onError: () => undefined });
    // Abandons what still waits, leaving the shell alone in the document, its boundaries at their fallbacks.
    shell.abort();
    const html = await new Response(stream).text();
    const words = SERVER_COPY.landing;
    for (const title of [words.pillars.title, words.join.title, words.season.title, words.organisers.title, COPY.page.sponsors]) {
      expect(html).toContain(`>${title}</h2>`);
    }
  });
});
