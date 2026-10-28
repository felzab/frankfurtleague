// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import SaisonLayout from "./[saison]/layout";
import SaisonsLayout from "./layout";

vi.mock("next/navigation", () => ({
  usePathname: () => "/saisons/2027",
  useParams: () => ({ saison: "2027" }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));
vi.mock("./[saison]/spielplan", () => ({ readSeasons: async () => ({ ids: ["2027", "2026"], standard: "2027" }) }));

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
    expect(screen.getAllByRole("button", { name: COPY.shared.saisonName("2027") }).length).toBeGreaterThan(0);
  });

  it("is not drawn again by the season's segment, which holds the page and its pop-up alone", () => {
    const { container } = render(
      <SaisonLayout
        params={Promise.resolve({ saison: "2027" })}
        modal={<p>Pop-up</p>}>
        <p>Seite</p>
      </SaisonLayout>,
    );

    expect(container.innerHTML).toBe("<p>Seite</p><p>Pop-up</p>");
  });
});
