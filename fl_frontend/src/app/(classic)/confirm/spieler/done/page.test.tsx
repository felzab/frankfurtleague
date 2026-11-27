// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { underNext } from "@/test-support/nextContexts";
import { drawnOnServer } from "@/test-support/server";

import { entryDoneAt } from "../../ends";
import RegistrierungConfirmedPage from "./page";

// The harm: a pupil's confirmation pressed in a second tab with other choices than the first is answered as confirmed,
// while the choices it carried are dropped, so the pupil believes a consent stands given or withdrawn that does not.
describe("a pupil's done page", () => {
  it("says the earlier choices stand where the press met a confirmation already standing", async () => {
    const address = new URL(entryDoneAt(ROUTES.registrierungConfirmationDone.path(), "kept"), "http://localhost:3000");
    const searchParams = Promise.resolve(Object.fromEntries(address.searchParams));
    const page = await drawnOnServer(
      underNext(await RegistrierungConfirmedPage({ params: Promise.resolve({}), searchParams }), { pathname: address.pathname }),
    );

    expect(page.textContent).toContain(SERVER_COPY.registrierungConfirmation.confirmed);
    expect(page.textContent).toContain(SERVER_COPY.entryConfirmation.choicesKept);
  });
});
