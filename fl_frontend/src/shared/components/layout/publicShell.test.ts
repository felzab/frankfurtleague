import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

/*
 What these cases are about is a wiring between files: which shell a page file mounts, and the class
 lists the shell and the footer carry. Read as text because `FooterCopyrightString` awaits
 `connection()`, which no render here resolves.
*/
const FOOTER = readFileSync(path.join(import.meta.dirname, "footer", "Footer.tsx"), "utf8");
const PUBLIC_SHELL = readFileSync(path.join(import.meta.dirname, "shell", "PublicShell.tsx"), "utf8");
const NOT_FOUND = readFileSync(path.join(SRC_DIR, "app", "not-found.tsx"), "utf8");
const PUBLIC_LAYOUT = readFileSync(path.join(SRC_DIR, "app", "(public)", "layout.tsx"), "utf8");

/** The hrefs of one footer link table, in the order the column renders them. */
function linkTabelle(name: string): string[] {
  const eintraege = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(FOOTER)?.[1] ?? "";

  return [...eintraege.matchAll(/href: "([^"]*)"/g)].map((treffer) => treffer[1] ?? "");
}

describe("where the public shell puts its footer", () => {
  /* A page shorter than the screen would otherwise park the footer at the bottom of the first one,
     where it reads as the end of a page the reader has not started. */
  it("holds the footer off the first screen", () => {
    assert.ok(PUBLIC_SHELL.includes("min-h-[calc(100dvh-var("), "the main region has no floor, so the footer rises into the first screen");
  });

  /* Every pixel the floor overshoots by is blank the reader scrolls past on a short page, and the
     header's border is outside the token the floor reads: `box-content` puts it there. */
  it("measures that floor against the header's whole box", () => {
    assert.match(PUBLIC_SHELL, /box-content h-\(--navbar-height\)[^"]*border-b/, "the header no longer wears its border outside its height");
    assert.ok(
      PUBLIC_SHELL.includes("min-h-[calc(100dvh-var(--navbar-height)-1px)]"),
      "the floor is read off the navbar token alone, so it overshoots the first screen by the header's border",
    );
  });

  /* A height the columns outgrow stops the fill where the separator and the copyright row are still
     being drawn, which is what a reader sees as the footer's bottom half falling off it. */
  it("gives the footer's fill a floor and never a height", () => {
    assert.ok(PUBLIC_SHELL.includes("lg:min-h-[220px]"), "the footer's wide-viewport size is not a floor");
    assert.ok(!PUBLIC_SHELL.includes("lg:h-[220px]"), "the footer is sized to a height its columns can outgrow");
  });
});

describe("which pages the public shell reaches", () => {
  /* Every public page is a child of this one layout and reaches the shell through nothing else, so
     the assertions above measure a shell no page wears the moment this line goes. */
  it("carries every page in the public route group", () => {
    assert.match(PUBLIC_LAYOUT, /<PublicShell[\s>]/, "the public pages lose their navigation, their skip link and their footer");
  });

  /* The root not-found file sits above the `(public)` route group and is handed none of that group's
     layout, so an unmatched URL carries the shell only while this file renders it. */
  it("carries the page an unmatched URL lands on", () => {
    assert.match(NOT_FOUND, /<PublicShell[\s>]/, "an unmatched URL meets a page with no navigation and no footer on it");
  });
});

describe("what the footer offers a reader", () => {
  /* Both columns render through one component, so which links each table holds is the whole of what
     can differ between them. */
  it("keeps the legal pages in a column of their own", () => {
    assert.deepEqual(linkTabelle("NAVIGATION_LINKS"), ["/about", "/organisation", "/kontakt"]);
    assert.deepEqual(linkTabelle("RECHTLICHES_LINKS"), ["/impressum", "/datenschutz"]);
  });

  /* An untitled column is a list a reader has to identify from its entries, and two `<nav>`s in one
     landmark are told apart by their names alone. */
  it("titles every column it offers", () => {
    for (const titel of ['title="Navigation"', 'title="Rechtliches"', ">Socials<"]) {
      assert.ok(FOOTER.includes(titel), `the footer renders no column titled by ${titel}`);
    }
  });
});
