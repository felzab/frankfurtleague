import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..");

/**
 * Destination → the glyph that names it, read off the sidemenu because that is where an admin learns the
 * pairing. One picture meaning two destinations is one neither of them can be recognised by.
 */
const GLYPH_OF = ((): Map<string, string> => {
  // Read from the SOURCE rather than imported: `constants.ts` pulls in the icon package, whose extensionless
  // ESM the test runner cannot resolve. The declaration is sliced first so nothing else in the file is read.
  const text = readFileSync(path.join(SRC_DIR, "features", "admin", "constants.ts"), "utf8");
  const start = text.indexOf("ADMIN_SIDEMENU_STRUCTURE");
  const block = text.slice(start, text.indexOf("];", start));
  const pairs = new Map<string, string>();

  for (const match of block.matchAll(/id: "([a-z]+)",[\s\S]{0,200}?iconName: "(\w+)"/g)) {
    if (match[1] !== undefined && match[2] !== undefined) pairs.set(match[1], match[2]);
  }

  return pairs;
})();

function collectTsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(full);

    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

type Action = { file: string; label: string; glyph: string; destination: string };

/**
 * Every row action that navigates to an admin SECTION. A second path segment means a record — `/admin/teams/{id}`
 * — whose glyph names the action taken on it rather than a place, so those are not the sidemenu's to answer for.
 */
function sectionActions(): Action[] {
  const found: Action[] = [];

  for (const file of collectTsxFiles(path.join(SRC_DIR, "features"))) {
    const text = readFileSync(file, "utf8");

    for (const match of text.matchAll(/<RowActionLink\b([\s\S]*?)<\/RowActionLink>/g)) {
      const body = match[1] ?? "";
      // `?` or the closing backtick ends a section path; `/` means a record id follows.
      const target = /\/admin\/([a-z]+)([`?"])/.exec(body);
      const label = /label="([^"]+)"/.exec(body)?.[1];
      const glyph = /<([A-Z]\w+)\s/.exec(body)?.[1];
      if (target === null || label === undefined || glyph === undefined) continue;

      found.push({ file: path.relative(SRC_DIR, file).split(path.sep).join("/"), label, glyph, destination: target[1] ?? "" });
    }
  }

  return found;
}

const actions = sectionActions();

describe("a row action's glyph names where it goes", () => {
  it("finds the sidemenu's pairings and the actions to hold against them", () => {
    // Anti-vacuity on both halves: a renamed export or a changed component name would otherwise leave
    // every case below true of an empty list.
    assert.ok(GLYPH_OF.size >= 10, `expected at least 10 sidemenu destinations, found ${String(GLYPH_OF.size)}`);
    assert.ok(actions.length >= 6, `expected at least 6 section row actions, found ${String(actions.length)}`);
  });

  for (const { file, label, glyph, destination } of actions) {
    it(`${file} — "${label}" uses the glyph for /admin/${destination}`, () => {
      const expected = GLYPH_OF.get(destination);
      assert.ok(expected !== undefined, `no sidemenu destination is named ${destination}, so nothing fixes its glyph`);
      assert.equal(glyph, expected, `"${label}" goes to /admin/${destination}, which the sidemenu names with <${String(expected)}>`);
    });
  }
});
