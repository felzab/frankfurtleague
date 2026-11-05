// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import { RailEntries } from "./FrameNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/saisons/2027/settings",
  useParams: () => ({ saison: "2027" }),
  useRouter: () => ({ push: () => undefined }),
}));

describe("the rail's current entry", () => {
  // The season editor's address lies under the season's Übersicht, so the longest prefix alone marks the Übersicht,
  // and the editor's way back leads there, with every other check green.
  it("is the one a page's route declares, where its address lies under another entry's", () => {
    render(
      <RailEntries
        groups={[
          {
            entries: [
              { id: "uebersicht", label: COPY.shared.overview, href: ROUTES.adminOverview.path("2027"), icon: "overview" },
              { id: "saisons", label: COPY.page.adminSaisons, href: ROUTES.adminSaisons.path(), icon: "saisons" },
            ],
          },
        ]}
      />,
    );

    const current = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toStrictEqual([COPY.page.adminSaisons]);
  });
});
