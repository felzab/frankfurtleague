import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

/*
 Read as text rather than rendered: `Footer` holds `FooterCopyrightString`, which awaits
 `connection()`, and `renderToStaticMarkup` renders nothing that suspends. The public layout is a
 layout file, and its own class lists are what the first two cases are about.
*/
const FOOTER = readFileSync(path.join(import.meta.dirname, "footer", "Footer.tsx"), "utf8");
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
    assert.ok(
      PUBLIC_LAYOUT.includes("min-h-[calc(100dvh-var(--navbar-height))]"),
      "the main region has no floor, so the footer rises into the first screen",
    );
  });

  /* A height the columns outgrow stops the fill where the separator and the copyright row are still
     being drawn, which is what a reader sees as the footer's bottom half falling off it. */
  it("gives the footer's fill a floor and never a height", () => {
    assert.ok(PUBLIC_LAYOUT.includes("lg:min-h-[220px]"), "the footer's wide-viewport size is not a floor");
    assert.ok(!PUBLIC_LAYOUT.includes("lg:h-[220px]"), "the footer is sized to a height its columns can outgrow");
  });
});

describe("what the footer offers a reader", () => {
  /* Both columns render through one component, so which links each table holds is the whole of what
     can differ between them. */
  it("keeps the legal pages in a column of their own", () => {
    assert.deepEqual(linkTabelle("NAVIGATION_LINKS"), ["/about", "/team", "/kontakt"]);
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
