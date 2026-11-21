// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { dayOf } from "@/core/format";
import { SERVER_COPY } from "@/core/serverCopy";
import { serveBackend } from "@/test-support/backend";
import { doubleNextRequest } from "@/test-support/nextRequest";
import { drawnOnServer } from "@/test-support/server";

import type { FLLandingResponse } from "@/core/generated/client/types";

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
async function rendered(window: FLLandingResponse["bewerbung_window"], opensOn: FLLandingResponse["bewerbung_opens_on"] = null) {
  landing = { saison: null, bewerbung_window: window, bewerbung_opens_on: opensOn, counts: COUNTS };
  return drawnOnServer(<HomePage />);
}

/** Every address the render links, by its `href`. */
const hrefs = (page: HTMLElement): (string | null)[] => [...page.querySelectorAll("a[href]")].map((link) => link.getAttribute("href"));

/** Every paragraph's words. */
const paragraphs = (page: HTMLElement): (string | null)[] => [...page.querySelectorAll("p")].map((paragraph) => paragraph.textContent);

// A door to the application form hidden while a window is open loses applications in silence.
describe("the landing's ways to apply", () => {
  it("lead to the form from the hero, the steps' band, the season card and the school's door while a window is open", async () => {
    const page = await rendered({ saison_id: "2028", end: "2028-01-31" });
    expect(hrefs(page).filter((href) => href === "/bewerbung")).toHaveLength(4);
  });
});

// A window about to open or closed reads on the band as the form's page reads it, so the two say one thing.
describe("the landing's band while no window is open", () => {
  it("names the day the next one opens", async () => {
    expect(paragraphs(await rendered(null, "2028-01-01"))).toContain(SERVER_COPY.bewerbung.end.opensOn(dayOf("2028-01-01")));
  });

  it("reads the form's closed sentence", async () => {
    expect(paragraphs(await rendered(null, null))).toContain(SERVER_COPY.bewerbung.end.closed);
  });
});
