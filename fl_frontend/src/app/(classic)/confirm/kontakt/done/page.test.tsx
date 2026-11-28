// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { underNext } from "@/test-support/nextContexts";
import { drawnOnServer } from "@/test-support/server";

import { entryDoneAt } from "../../ends";
import KontaktConfirmedPage from "./page";

import type { DoneEnd } from "../../ends";

const WORDS = SERVER_COPY.entryConfirmation;

/** The done page as the press that reached `end` leads the person to it, drawn on the server. */
async function drawnAt(end: DoneEnd): Promise<HTMLElement> {
  const address = new URL(entryDoneAt(ROUTES.kontaktConfirmationDone.path(), end), "http://localhost:3000");
  const searchParams = Promise.resolve(Object.fromEntries(address.searchParams));
  return drawnOnServer(underNext(await KontaktConfirmedPage({ params: Promise.resolve({}), searchParams }), { pathname: address.pathname }));
}

// The harm: a confirmation pressed in a second tab with other choices than the first is answered as confirmed, while the
// choices it carried are dropped, so the person believes a consent stands given or withdrawn that does not.
describe("a contact's done page", () => {
  it("says the earlier choices stand where the press met a confirmation already standing", async () => {
    const page = await drawnAt("kept");
    expect(page.textContent).toContain(WORDS.confirmed);
    expect(page.textContent).toContain(WORDS.choicesKept);
  });
});
