import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import SpielplanPage from "./page";

import type { FLSpielplanResponse } from "@/core/generated/client/types";
import type { ComponentProps } from "react";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

/** One match of the matchday `key`, its id naming the matchday so a test can tell the panels apart. */
const spiel = (key: string) => ({
  id: `sp-${key}`,
  saison_id: "2027",
  spieltag_id: `id-${key}`,
  spiel_nr: 1,
  saison_phase: "gruppenphase" as const,
  datum: null,
  uhrzeit: null,
  ergebnis: null,
  elfmeterschiessen: null,
  sonderereignis: null,
  notiz: null,
  ort: null,
  schiedsrichter: null,
  ansetzung_confirmed: null,
  team1: { team_id: "t1", name: "Woehlerschule", shorthand: "WOE", tore: null, austritt_type: null },
  team2: { team_id: "t2", name: "Ernst-Reuter-Schule", shorthand: "ERS", tore: null, austritt_type: null },
  team1_quelle: null,
  team2_quelle: null,
});

// The season's three matchdays, the second the current one. A matchday's id is a database id the address never
// shows; its key is its phase and position.
const SPIELPLAN = {
  current_spieltag_id: "id-gruppenphase-2",
  spieltage: [
    ["gruppenphase", 1],
    ["gruppenphase", 2],
    ["finale", 1],
  ].map(([phase, position]) => {
    const key = `${String(phase)}-${String(position)}`;
    return {
      id: `id-${key}`,
      saison_id: "2027",
      saison_phase: phase,
      position,
      beginn: null,
      ende: null,
      count_spiele: 1,
      version: 1,
      spiele: [spiel(key)],
    };
  }),
} as FLSpielplanResponse;

vi.mock("@/features/saisons/queries", () => ({ getSpielplan: async () => SPIELPLAN }));

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
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Finale</);
    expect(html).toContain('href="/saisons/2027/spiele/sp-finale-1"');
    expect(html).not.toContain('href="/saisons/2027/spiele/sp-gruppenphase-2"');
  });

  it("renders the matchday the backend names current chosen where the address names none", async () => {
    const html = await rendered({});
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>2. Spieltag</);
    expect(html).toContain('href="/saisons/2027/spiele/sp-gruppenphase-2"');
  });

  it("does not take a matchday's database id as its name", async () => {
    const html = await rendered({ tab: "id-finale-1" });
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>2. Spieltag</);
  });

  it("renders each tab, each match card and the magnifier as a link a press loads before hydration", async () => {
    const html = await rendered({});
    expect(html).toMatch(/<a[^>]*href="\?tab=finale-1"[^>]*>Finale</);
    expect(html).toMatch(/<a[^>]*href="\/saisons\/2027\/spiele\/sp-gruppenphase-2"/);
    expect(html).toMatch(/<a[^>]*href="\/saisons\/2027\/search"/);
  });
});
