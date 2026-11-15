import { serveBackend } from "@/test-support/backend.ts";
import { doubleNextRequest } from "@/test-support/nextRequest.ts";
import { describe, expect, it } from "vitest";

import { SERVER_COPY } from "@/core/serverCopy";

import type { FLBewerbungFormResponse, FLLandingResponse } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { ReactElement } from "react";

/** The season whose window runs while one does. */
const SAISON = "2028";

/** That season's form, its window running. */
const FORM: FLBewerbungFormResponse = { schulen: [], taken: [], window: { start: "2027-12-01", state: "running" } };

/** The landing's window each case serves. */
let running: FLLandingResponse["bewerbung_window"] = null;

// The landing's read and the one season's form alone: a form asked of any other season goes unanswered, which fails
// the case.
serveBackend(({ method, path }) =>
  method !== "GET"
    ? undefined
    : path === "/saisons/landing"
      ? {
          saison: null,
          bewerbung_window: running,
          bewerbung_opens_on: null,
          bewerbung_window_held: false,
          counts: { count_saisons: 0, count_schulen: 0, count_spiele: 0, count_tore: 0 },
        }
      : path === `/bewerbungen/form/${SAISON}`
        ? FORM
        : undefined,
);
// The landing's read is cached, declaring its tag and lifetime through `next/cache`, and the form's read runs under the
// request's trace, read off `next/headers`.
doubleNextRequest();

const { default: BewerbungRootPage } = await import("./page");

/** What the page shows, as the template is handed it. */
async function state(): Promise<MailedState> {
  return (BewerbungRootPage() as ReactElement<{ page: Promise<MailedState> }>).props.page;
}

// The harm: the footer's one way to applying leads every visitor here, so an address that showed no form while a window
// runs, or failed while none does, loses applications in silence.
describe("the application's address naming no season", () => {
  it("draws the form of the season whose window runs", async () => {
    running = { saison_id: SAISON, end: "2028-01-31" };
    expect(await state()).toMatchObject({ state: "question", carry: { saison_id: SAISON } });
  });

  it("draws the closed card while no window runs", async () => {
    running = null;
    expect(await state()).toMatchObject({ state: "end", title: SERVER_COPY.bewerbung.end.closed });
  });
});
