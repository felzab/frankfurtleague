// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import SaisonsLayout from "./layout";

vi.mock("next/navigation", () => ({
  usePathname: () => "/saisons/2027",
  useParams: () => ({ saison: "2027" }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));
vi.mock("./[saison]/spielplan", () => ({
  readSeasons: async () => ({
    entries: [
      { id: "2027", span: "01.09.2026 – 30.06.2027" },
      { id: "2026", span: "01.09.2025 – 30.06.2026" },
    ],
    standard: "2027",
  }),
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

    expect(screen.getAllByRole("link", { name: COPY.seite.spielplan }).map((link) => link.getAttribute("href"))).toContain("/saisons/2027");
    expect(screen.getAllByRole("button", { name: new RegExp(COPY.shared.saisonName("2027")) }).length).toBeGreaterThan(0);
  });
});
