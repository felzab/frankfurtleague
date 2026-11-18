// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SERVER_COPY } from "@/core/serverCopy";
import { renderUnderNext } from "@/test-support/nextContexts";

import NoPopupFound from "./not-found";

// The dialog's close goes through Next's router, which no test mounts.

// The harm: a match row pressed after its match was deleted changes the address and shows nothing, a path rare enough
// that no one would notice its pop-up gone.
describe("the pop-up slot's not-found", () => {
  it("opens the dialog named by the not-found card's title", () => {
    renderUnderNext(<NoPopupFound />);

    expect(screen.getByRole("dialog", { name: SERVER_COPY.notFound })).toBeTruthy();
  });
});
