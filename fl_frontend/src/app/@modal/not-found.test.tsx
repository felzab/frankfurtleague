// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SERVER_COPY } from "@/core/serverCopy";

import NoPopupFound from "./not-found";

import type * as Navigation from "next/navigation";

// The dialog's close goes through Next's router, which no test mounts.
vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof Navigation>()), useRouter: () => ({}) }));

// The harm: a match row pressed after its match was deleted changes the address and shows nothing, a path rare enough
// that no one would notice its pop-up gone.
describe("the pop-up slot's not-found", () => {
  it("opens the dialog named by the not-found card's title", () => {
    render(<NoPopupFound />);

    expect(screen.getByRole("dialog", { name: SERVER_COPY.notFound })).toBeTruthy();
  });
});
