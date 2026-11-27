import path from "node:path";

import { describe, expect, it } from "vitest";

import { filesUnder } from "@/test-support/treeWalk";

import { addressOf, ROUTES } from "./routes";

import type { RouteEntry } from "./routes";

const APP = path.resolve(import.meta.dirname, "..", "app");

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

/** The league's own words an address carries: each a plural or a spelling of a core entity or attribute. */
const LEAGUE_WORDS = [
  "saisons",
  "spiel",
  "spiele",
  "spieltage",
  "aufstellung",
  "team",
  "teams",
  "spieler",
  "kader",
  "schiedsrichter",
  "spielorte",
  "bewerbung",
  "bewerbungen",
  "registrierung",
  "registrierungen",
  "spielbericht",
  "tabelle",
  "ko-runde",
  "kontakt",
];

/**
 * The English words an address may carry. An address follows the code's naming rule: a segment is German only where
 * it is the league's own word, and every word for what the website does with one is English and stands here, so a new
 * word is added here, in English, or the build fails.
 */
const ADDRESS_WORDS = [
  "about",
  "account",
  "address",
  "address-changes",
  "admin",
  "administrators",
  "api",
  "area",
  "auth",
  "ban-list",
  "bulk",
  "client-error",
  "confirm",
  "contact",
  "continue",
  "delivery",
  "done",
  "entries",
  "erasure",
  "erasures",
  "log",
  "mail",
  "passkey",
  // A Funktion's code word, `role`, in the plural.
  "roles",
  "search",
  "security",
  "settings",
  "signin",
  "sitemap",
  "sponsors",
  "withdrawals",
  // The one exception, two German words naming no league thing: the Impressum is a duty under German law, and
  // `/impressum` and `/datenschutz` are where a German visitor looks for it and for the privacy notice.
  "impressum",
  "datenschutz",
];

/** A placeholder no address word can be, standing in for each of a row's own segments. */
const PLACEHOLDER = "[]";

/** Every address this tree answers at, a row's and a page's or route handler's, by where it is written. */
function addresses(): { where: string; segments: string[] }[] {
  const rows = Object.entries(ROUTES as Record<string, RouteEntry>).map(([key, row]) => {
    const address = addressOf(row, PLACEHOLDER);
    return { where: `ROUTES.${key}`, segments: address.split("/").filter((segment) => segment !== "") };
  });
  const files = filesUnder(APP, (name) => name === "page.tsx" || name === "route.ts", 40).map((file) => ({
    where: path.relative(APP, file).split(path.sep).join("/"),
    segments: segmentsOf(file),
  }));
  return [...rows, ...files];
}

describe("every address", () => {
  // The code's naming rule, held for addresses as the lint holds it for names: a word for what the website does in
  // German, or an English word nobody listed, fails here rather than reaching a visitor's address bar.
  it("carries only league words and the listed English words in its fixed segments", () => {
    const allowed = new Set([...LEAGUE_WORDS, ...ADDRESS_WORDS]);
    const strays = addresses().flatMap(({ where, segments }) =>
      segments.filter((segment) => !segment.startsWith("[") && !allowed.has(segment)).map((segment) => `${where}: ${segment}`),
    );
    expect(strays).toStrictEqual([]);
  });
});
