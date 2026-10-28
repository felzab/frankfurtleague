import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import SpielplanPage from "./page";

import type { ComponentProps } from "react";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/saisons/2027" }));

// The season's three matchdays, the second the current one, each holding one match named for its matchday.
vi.mock("./spielplan", () => ({
  readSaison: async (id: string) => ({ saison: { id } }),
  readSpielplan: async () => ({
    current: "st-2",
    matchdays: ["st-1", "st-2", "st-3"].map((id) => ({ id, label: `Spieltag ${id}`, spiele: [`sp-${id}`] })),
  }),
  matchRowOf: (spiel: string) => ({
    id: spiel,
    href: `/saisons/2027/spiele/${spiel}`,
    when: "Termin offen",
    home: { name: "Woehlerschule", plaque: { kuerzel: "WO" } },
    away: { name: "Ernst-Reuter-Schule", plaque: { kuerzel: "ER" } },
  }),
}));

/** The page's whole server render for the address's query: the document a browser shows before hydrating. */
async function rendered(query: Record<string, string>) {
  const stream = await renderToReadableStream(
    <SpielplanPage
      params={Promise.resolve({ saison: "2027" })}
      searchParams={Promise.resolve(query)}
    />,
  );
  await stream.allReady;
  return new Response(stream).text();
}

describe("the Spielplan's server render", () => {
  it("renders the matchday the address names chosen, its matches in the panel", async () => {
    const html = await rendered({ tab: "st-3" });
    expect(html).toMatch(/<a[^>]*aria-selected="true"[^>]*>Spieltag st-3</);
    expect(html).toContain('href="/saisons/2027/spiele/sp-st-3"');
    expect(html).not.toContain('href="/saisons/2027/spiele/sp-st-2"');
  });

  it("renders the current matchday chosen where the address names none", async () => {
    const html = await rendered({});
    expect(html).toMatch(/<a[^>]*aria-selected="true"[^>]*>Spieltag st-2</);
    expect(html).toContain('href="/saisons/2027/spiele/sp-st-2"');
  });

  it("renders each tab and each match row as a link a press loads before hydration", async () => {
    const html = await rendered({});
    expect(html).toMatch(/<a[^>]*href="\/saisons\/2027\?tab=st-3"[^>]*>Spieltag st-3</);
    expect(html).toMatch(/<a[^>]*href="\/saisons\/2027\/spiele\/sp-st-2"/);
  });
});
