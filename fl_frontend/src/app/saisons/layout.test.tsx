// @vitest-environment jsdom
import { WholePages } from "@/kit/WholePage";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { COPY } from "@/core/copy";

import SaisonsLayout from "./layout";

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
vi.mock("@/features/saisons/queries", () => ({
  getSaisonFrame: async () =>
    ({
      saisons: [
        { id: "2027", start_date: "2026-09-01", end_date: "2027-06-30" },
        { id: "2026", start_date: "2025-09-01", end_date: "2026-06-30" },
      ],
      active_saison_id: "2027",
    }) satisfies FLSaisonFrameResponse,
}));

describe("the public season pages' frame", () => {
  // The not-found page stands inside this frame, so a menu following an unknown season would lead every entry to a 404.
  it("keeps its menus on the site's season where the address names one the frame does not hold", async () => {
    address.saison = "1999";
    onTestFinished(() => {
      address.saison = "2027";
    });
    await act(async () => {
      render(
        <WholePages>
          <SaisonsLayout>
            <p>Seite</p>
          </SaisonsLayout>
        </WholePages>,
      );
    });

    expect(screen.getAllByRole("link", { name: COPY.page.tabelle }).map((link) => link.getAttribute("href"))).toContain(
      "/saisons/2027/tabelle",
    );
  });
});
