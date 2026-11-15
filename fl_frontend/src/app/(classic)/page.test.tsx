import { serveBackend } from "@/test-support/backend.ts";
import { doubleNextRequest } from "@/test-support/nextRequest.ts";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { dayOf } from "@/core/format";
import { SERVER_COPY } from "@/core/serverCopy";

import type { FLLandingResponse } from "@/core/generated/client/types";
import type { ComponentProps } from "react";

vi.mock("next/link", async (original) => ({
  ...(await original<object>()),
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

/** The landing's figures: none yet. */
const COUNTS: FLLandingResponse["counts"] = { count_saisons: 0, count_schulen: 0, count_spiele: 0, count_tore: 0 };

/** The landing's read each case serves, which `rendered` sets. */
let landing: FLLandingResponse | undefined;

// The landing's one read alone: any other request goes unanswered, which fails the case.
serveBackend(({ method, path }) => (method === "GET" && path === "/saisons/landing" ? landing : undefined));
// The landing's read is cached, and declares its tag and lifetime through `next/cache`, answering only in Next's cache scope.
doubleNextRequest();

const { default: HomePage } = await import("./page");

/** The landing's whole server render for the window given: the document a browser shows before hydrating. */
async function rendered(
  window: FLLandingResponse["bewerbung_window"],
  opensOn: FLLandingResponse["bewerbung_opens_on"] = null,
  { held = false, saison = null }: { held?: boolean; saison?: FLLandingResponse["saison"] } = {},
) {
  landing = { saison, bewerbung_window: window, bewerbung_opens_on: opensOn, bewerbung_window_held: held, counts: COUNTS };
  const stream = await renderToReadableStream(<HomePage />);
  await stream.allReady;
  return new Response(stream).text();
}

/** Every address the render links, by its `href`. */
const hrefs = (html: string): string[] =>
  [...html.matchAll(/<a[^>]*href="([^"]+)"/g)].flatMap(([, href]) => (href === undefined ? [] : [href]));

/** Every paragraph's words. */
const paragraphs = (html: string): string[] =>
  [...html.matchAll(/<p[^>]*>([^<]*)<\/p>/g)].flatMap(([, words]) => (words === undefined ? [] : [words]));

// A door to the application form hidden while a window is open loses applications in silence.
describe("the landing's ways to apply", () => {
  it("lead to the form from the hero, the steps' band, the season card and the school's door while a window is open", async () => {
    const html = await rendered({ saison_id: "2028", end: "2028-01-31" });
    expect(hrefs(html).filter((href) => href === "/bewerbung/2028")).toHaveLength(4);
  });
});

/** A season all four of whose places are in, the state in which next season's window is most likely to stand. */
const DECIDED: FLLandingResponse["saison"] = {
  id: "2027",
  state: "decided",
  starts_at: "2027-03-01T10:00:00+01:00",
  podium: [null, null, null, null],
  teams: [],
};

// The closed band sends a school to next season, which a window about to open or standing paused makes false where only
// the form's page says so: the landing's primary call to apply would turn a school away for a two-week pause.
describe("the landing's band while no window is open", () => {
  it("names the day the next one opens", async () => {
    expect(paragraphs(await rendered(null, "2028-01-01", { held: true, saison: DECIDED }))).toContain(
      SERVER_COPY.bewerbung.end.opensOn(dayOf("2028-01-01")),
    );
  });

  it("reads as the form's page while a season not ended holds a window, next year's paused one beside a decided season", async () => {
    expect(paragraphs(await rendered(null, null, { held: true, saison: DECIDED }))).toContain(SERVER_COPY.bewerbung.end.closed);
  });

  it("sends a school to next season only where no season not ended holds one", async () => {
    expect(paragraphs(await rendered(null, null, { held: false, saison: DECIDED }))).toContain(SERVER_COPY.landing.join.closed);
  });
});
