// @vitest-environment jsdom
import { underNext } from "@/test-support/nextContexts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SERVER_COPY } from "@/core/serverCopy";

import NoPopupFound from "./not-found";

import type { ReactNode } from "react";

// The dialog's close goes through Next's router, which no test mounts.
const Next = ({ children }: { children: ReactNode }) => underNext(children);

// The harm: a match row pressed after its match was deleted changes the address and shows nothing, a path rare enough
// that no one would notice its pop-up gone.
describe("the pop-up slot's not-found", () => {
  it("opens the dialog named by the not-found card's title", () => {
    render(<NoPopupFound />, { wrapper: Next });

    expect(screen.getByRole("dialog", { name: SERVER_COPY.notFound })).toBeTruthy();
  });
});
