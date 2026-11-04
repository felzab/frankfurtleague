// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import SaisonsLayout from "./layout";

import type { FLSaisonFrameResponse } from "@/core/generated/client/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/saisons/2027",
  useParams: () => ({ saison: "2027" }),
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

// Next keys a dynamic segment's subtree on its value, so whatever the `[saison]` layout draws is drawn anew
// in the other season; the frame is kept only where it stands above that segment.
describe("the public season pages' frame", () => {
  it("stands in the layout above the season's segment, its menus reading the season from the address", async () => {
    await act(async () => {
      render(
        <SaisonsLayout>
          <p>Seite</p>
        </SaisonsLayout>,
      );
    });

    expect(screen.getAllByRole("link", { name: COPY.page.spielplan }).map((link) => link.getAttribute("href"))).toContain("/saisons/2027");
    expect(screen.getAllByRole("link", { name: COPY.page.tabelle }).map((link) => link.getAttribute("href"))).toContain(
      "/saisons/2027/tabelle",
    );
    expect(screen.getAllByRole("button", { name: new RegExp(COPY.shared.saisonName("2027")) }).length).toBeGreaterThan(0);
  });
});
