import { readFileSync } from "node:fs";
import path from "node:path";

import { filesUnder } from "@/test-support/treeWalk.ts";
import { describe, expect, it } from "vitest";

import { ADDRESS_WORDS, ROUTES } from "./routes.ts";

import type { RouteEntry } from "./routes.ts";

const APP = path.resolve(import.meta.dirname, "..", "app");
const GLOSSARY = path.resolve(import.meta.dirname, "..", "..", "..", "docs", "glossary.md");

/**
 * The segments a route folder answers at: a route group's `(…)` and a parallel slot's `@…` are no segment, an
 * interception's `(.)` prefix leaves its segment, and a dynamic `[…]` is kept as written.
 */
function segmentsOf(file: string): string[] {
  return path
    .relative(APP, path.dirname(file))
    .split(path.sep)
    .filter((folder) => folder !== "" && !/^\(.*\)$/.test(folder) && !folder.startsWith("@"))
    .map((folder) => folder.replace(/^(\(\.{1,3}\))+/, ""));
}

/** The address each page file answers at. */
const PAGES = new Set(filesUnder(APP, (name) => name === "page.tsx", 20).map((file) => `/${segmentsOf(file).join("/")}`));

describe("the pages a mail opens", () => {
  // Their rows decide what robots.txt refuses and what each page names as its own address, while each mail builds
  // its link from its own constant, which `scripts/checks/check_public_routes.py` holds to a page file.
  it.each([
    "addressChangeConfirmation",
    "kontaktConfirmation",
    "schiedsrichterConfirmation",
    "spielbestaetigung",
    "registrierungConfirmation",
    "accountErasure",
    "registrierung",
  ] as const)("answer at the %s row's address", (row) => {
    expect(PAGES.has(ROUTES[row].path())).toBe(true);
  });
});

describe("the links every rail frame writes", () => {
  // The rail's foot signed out, and the strip's and „Mehr“'s two legal pages.
  it.each(["signIn", "legalNotice", "privacyNotice"] as const)("lead to a page answering at the %s row's address", (row) => {
    expect(PAGES.has(ROUTES[row].path())).toBe(true);
  });
});

/**
 * The league's own words an address carries, each by the glossary entry naming it: a segment is a plural or a
 * spelling of its entry's word, and the entry stands in the glossary's core entities or attributes.
 */
const LEAGUE_WORDS: Readonly<Record<string, string>> = {
  saisons: "Saison",
  spiel: "Spiel",
  spiele: "Spiel",
  team: "Team",
  teams: "Team",
  spieler: "Spieler",
  kader: "Kader",
  schiedsrichter: "Schiedsrichter",
  spielorte: "Spielort",
  bewerbung: "Bewerbung",
  bewerbungen: "Bewerbung",
  registrierung: "Registrierung",
  registrierungen: "Registrierung",
  sperrliste: "Sperrliste",
  spielbericht: "Spielbericht",
  tabelle: "Tabelle",
  "ko-runde": "K.-o.-Runde",
  kuerzel: "Kürzel",
  kontakt: "kontakte",
};

/**
 * Trees the rule does not hold yet, each by its address prefix, each gone with the pages it names.
 */
const UNHELD = [
  // Redesign: goes with the old admin pages, sessions 5 to 7.
  "/area/admin",
  // Redesign: goes with their last importers, sessions 5, 6 and 8.
  "/api/bestaetigung",
];

/** Every word the glossary's core entities and attributes head an entry with. */
function glossaryWords(): Set<string> {
  const text = readFileSync(GLOSSARY, "utf8");
  const held = text.slice(text.indexOf("\n## Core entities"), text.indexOf("\n## Terms that are not domain vocabulary"));
  const headings = held.split("\n").filter((line) => line.startsWith("### "));
  // The entry's words stand before its gloss, the dash, so a word the gloss quotes is no entry's.
  const named = headings.map((heading) => heading.split(" — ", 1).join(""));
  return new Set(named.flatMap((heading) => [...heading.matchAll(/`([^`]+)`/g)].flatMap((word) => word.slice(1))));
}

/** A placeholder no address word can be, standing in for each of a row's own segments. */
const PLACEHOLDER = "[]";

/** Every address this tree answers at, a row's and a page's or route handler's, by where it is written. */
function addresses(): { where: string; segments: string[] }[] {
  const rows = Object.entries(ROUTES as Record<string, RouteEntry>).map(([key, row]) => {
    const build = row.path as (...segments: string[]) => string;
    const address = build(...Array.from({ length: build.length }, () => PLACEHOLDER));
    return { where: `ROUTES.${key}`, segments: address.split("/").filter((segment) => segment !== "") };
  });
  const files = filesUnder(APP, (name) => name === "page.tsx" || name === "route.ts", 40).map((file) => ({
    where: path.relative(APP, file).split(path.sep).join("/"),
    segments: segmentsOf(file),
  }));
  return [...rows, ...files].filter(({ segments }) => !UNHELD.some((prefix) => `/${segments.join("/")}`.startsWith(prefix)));
}

describe("every address", () => {
  // The code's naming rule, held for addresses as the lint holds it for names: a word for what the website does in
  // German, or an English word nobody listed, fails here rather than reaching a visitor's address bar.
  it("carries only league words and the listed English words in its fixed segments", () => {
    const allowed = new Set<string>([...Object.keys(LEAGUE_WORDS), ...ADDRESS_WORDS]);
    const strays = addresses().flatMap(({ where, segments }) =>
      segments.filter((segment) => !segment.startsWith("[") && !allowed.has(segment)).map((segment) => `${where}: ${segment}`),
    );
    expect(strays).toStrictEqual([]);
  });

  it("takes each league word from an entry of the glossary's core entities or attributes", () => {
    const words = glossaryWords();
    expect(Object.entries(LEAGUE_WORDS).filter(([, entry]) => !words.has(entry))).toStrictEqual([]);
  });
});
