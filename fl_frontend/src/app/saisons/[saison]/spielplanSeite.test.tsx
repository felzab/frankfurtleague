import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import SpielplanPage from "./page";

import type { ComponentProps } from "react";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

// The season's three matchdays, the second the current one, each holding one match named for its matchday.
// A matchday's id is a database id the address never shows; its key is its phase and position.
const MATCHDAYS = [
  { id: "id-a", key: "gruppenphase-1" },
  { id: "id-b", key: "gruppenphase-2" },
  { id: "id-c", key: "finale-1" },
];
vi.mock("./spielplan", () => ({
  readSaison: async (id: string) => ({ saison: { id } }),
  readSpielplan: async () => ({
    current: "id-b",
    matchdays: MATCHDAYS.map(({ id, key }) => ({ id, key, label: `Spieltag ${key}`, spiele: [`sp-${key}`] })),
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
    const html = await rendered({ tab: "finale-1" });
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Spieltag finale-1</);
    expect(html).toContain('href="/saisons/2027/spiele/sp-finale-1"');
    expect(html).not.toContain('href="/saisons/2027/spiele/sp-gruppenphase-2"');
  });

  it("renders the current matchday chosen where the address names none", async () => {
    const html = await rendered({});
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Spieltag gruppenphase-2</);
    expect(html).toContain('href="/saisons/2027/spiele/sp-gruppenphase-2"');
  });

  it("does not take a matchday's database id as its name", async () => {
    const html = await rendered({ tab: "id-c" });
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Spieltag gruppenphase-2</);
  });

  it("renders each tab and each match row as a link a press loads before hydration", async () => {
    const html = await rendered({});
    expect(html).toMatch(/<a[^>]*href="\?tab=finale-1"[^>]*>Spieltag finale-1</);
    expect(html).toMatch(/<a[^>]*href="\/saisons\/2027\/spiele\/sp-gruppenphase-2"/);
  });
});
