// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import { HeaderLinks } from "./FrameNav";

import type { HeaderLink } from "./FrameNav";

vi.mock("next/navigation", () => ({ usePathname: () => "/kontakt" }));

const LINKS = [
  { label: COPY.page.about, href: ROUTES.about.path() },
  { label: COPY.page.contact, href: ROUTES.contact.path() },
] as const;

/** The header's row on a desktop, its season read as given. */
async function renderRow(season: Promise<HeaderLink | null>) {
  await act(async () =>
    render(
      <HeaderLinks
        season={season}
        links={LINKS}
        signIn={ROUTES.signIn.path()}
      />,
    ),
  );
  return within(screen.getByRole("navigation", { name: COPY.template.navigation }));
}

describe("the classic header's season entry", () => {
  it("leads the header's links once the season the site is on is read", async () => {
    const row = await renderRow(Promise.resolve({ label: COPY.shared.saisonName("2026"), href: ROUTES.spielplan.path("2026") }));
    expect(row.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toStrictEqual([
      [COPY.shared.saisonName("2026"), "/saisons/2026"],
      [COPY.page.about, "/about"],
      [COPY.page.contact, "/kontakt"],
    ]);
  });

  it("is left out where the league has no season", async () => {
    const row = await renderRow(Promise.resolve(null));
    expect(row.getAllByRole("link").map((link) => link.textContent)).toStrictEqual([COPY.page.about, COPY.page.contact]);
  });
});
