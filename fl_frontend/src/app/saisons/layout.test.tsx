// @vitest-environment jsdom
import { Suspense } from "react";

import { serveBackend } from "@/test-support/backend.ts";
import { doubleNextRequest } from "@/test-support/nextRequest.ts";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { COPY } from "@/core/copy";

import type { FLSaisonFrameResponse } from "@/core/generated/client/types";

/** The season the address names; a case naming one the frame does not hold sets it. */
const address = vi.hoisted(() => ({ saison: "2027" }));
vi.mock("next/navigation", () => ({
  usePathname: () => `/saisons/${address.saison}`,
  useParams: () => ({ saison: address.saison }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
// Typed whole, so a field the frame stops serving fails the compile rather than standing in the fixture.
const FRAME = {
  saisons: [
    { id: "2027", start_date: "2026-09-01", end_date: "2027-06-30" },
    { id: "2026", start_date: "2025-09-01", end_date: "2026-06-30" },
  ],
  active_saison_id: "2027",
} satisfies FLSaisonFrameResponse;

// The season pages' frame alone: any other read goes unanswered, which fails the case.
serveBackend(({ method, path }) => (method === "GET" && path === "/saisons/frame" ? FRAME : undefined));
// The frame is a cached read, which declares its tag and lifetime through `next/cache`, answering only in Next's cache scope.
doubleNextRequest();

const { default: SaisonsLayout } = await import("./layout");

describe("the public season pages' frame", () => {
  // The not-found page stands inside this frame, so a menu following an unknown season would lead every entry to a 404.
  it("keeps its menus on the site's season where the address names one the frame does not hold", async () => {
    address.saison = "1999";
    onTestFinished(() => {
      address.saison = "2027";
    });
    // The layout is a server component the server renders once, so it is called once here and its read begins once:
    // drawn as a component by the browser's React, each retry would begin it anew, and a read answered over the network
    // would never settle before the next retry. The render stands in a boundary of its own, where the suspended read
    // settles.
    const frame = SaisonsLayout({ children: <p>Seite</p> });
    await act(async () => render(<Suspense>{frame}</Suspense>));

    const tabelle = await screen.findAllByRole("link", { name: COPY.page.tabelle });
    expect(tabelle.map((link) => link.getAttribute("href"))).toContain("/saisons/2027/tabelle");
  });
});
