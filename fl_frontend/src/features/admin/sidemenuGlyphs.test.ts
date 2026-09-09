import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

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

  for (const match of block.matchAll(/id: "([a-z_]+)",[\s\S]{0,200}?iconName: "(\w+)"/g)) {
    if (match[1] !== undefined && match[2] !== undefined) pairs.set(match[1], match[2]);
  }

  return pairs;
})();

const collectTsxFiles = (dir: string): string[] => filesUnder(dir, (name) => name.endsWith(".tsx") && !isTestFile(name), 100);

/** `?` or the closing backtick ends a section path; a `/` there means a record id follows. */
const SECTION = /\/admin\/([a-z_]+)([`?"])/;
/**
 * A literal in-app path written into the href. An expression assembling one out of pieces leaves
 * this reader nothing to place, and `external` is the only reason a destination has no such path.
 */
const WRITTEN_PATH = /["`]\//;
/* Both shapes: a row offers one way elsewhere inline and several through a menu
   (`fl_frontend/src/shared/components/ui/RowActions.tsx :: RowActionMenu`), and the sidemenu
   answers for the glyph either way. */
const OPENING = /<RowAction(?:Link|MenuItem)\b/g;
const ELEMENT = /<RowAction(Link|MenuItem)\b([\s\S]*?)<\/RowAction\1>/g;

type Action = { file: string; label: string; glyph: string | null; href: string; external: boolean };

/**
 * Every row action that leaves its row, whatever it points at, beside the count of opening tags a
 * second reader found. Classifying here would drop what it cannot read; the cases below fail it.
 */
function rowActions(): { actions: Action[]; opened: number } {
  const found: Action[] = [];
  let opened = 0;

  for (const file of collectTsxFiles(path.join(SRC_DIR, "features"))) {
    const text = readFileSync(file, "utf8");
    opened += text.match(OPENING)?.length ?? 0;

    for (const match of text.matchAll(ELEMENT)) {
      const body = match[2] ?? "";
      // Both JSX spellings, and neither decides membership: a label is this case's title, and an
      // action whose label is an expression is one the pairing below still has to hold.
      const label = /label=(?:"([^"]+)"|\{([^\n]+)\})/.exec(body);

      found.push({
        file: path.relative(SRC_DIR, file).split(path.sep).join("/"),
        label: label?.[1] ?? label?.[2] ?? "",
        glyph: /<([A-Z]\w+)\s/.exec(body)?.[1] ?? null,
        // To the line's end: the classification reads whether a path is written, never the call around it.
        href: /href=\{?([^\n]*)/.exec(body)?.[1]?.trim() ?? "",
        external: /\bexternal\b/.test(body),
      });
    }
  }

  return { actions: found, opened };
}

const { actions, opened } = rowActions();

/**
 * The actions the sidemenu answers for. A second path segment means a record — `/admin/teams/{id}` —
 * whose glyph names the action taken on it rather than a place.
 */
const sections = actions.flatMap((action) => {
  const target = SECTION.exec(action.href);

  return target === null ? [] : [{ ...action, destination: target[1] ?? "" }];
});

describe("a row action's glyph names where it goes", () => {
  it("finds the sidemenu's pairings and the actions to hold against them", () => {
    // Anti-vacuity on both halves: a renamed export or a changed component name would otherwise leave
    // every case below true of an empty list.
    assert.ok(GLYPH_OF.size >= 12, `expected at least 12 sidemenu destinations, found ${String(GLYPH_OF.size)}`);

    /* Two readers over one population: the opening tags, and the element bodies the walk above
       parsed. Before the floor, which a shrunken population reaches first and answers less exactly. */
    assert.equal(actions.length, opened, `parsed ${String(actions.length)} row actions where ${String(opened)} are opened`);
    assert.ok(sections.length >= 6, `expected at least 6 section row actions, found ${String(sections.length)}`);
  });

  /* A destination the reader cannot place is a finding, never a member it drops: dropping one is
     how three more could vanish under a floor the rest of the population keeps green. */
  it("points every row action at a path this reader can place, or declares it external", () => {
    for (const { file, label, href, external } of actions) {
      assert.ok(
        WRITTEN_PATH.test(href) || external,
        `${file}: "${label}" points at ${href}, which writes no path this reader can place and is not marked external`,
      );
    }
  });

  for (const { file, label, glyph, destination } of sections) {
    it(`${file} — "${label}" uses the glyph for /admin/${destination}`, () => {
      const expected = GLYPH_OF.get(destination);
      assert.ok(expected !== undefined, `no sidemenu destination is named ${destination}, so nothing fixes its glyph`);
      assert.ok(glyph !== null, `"${label}" goes to /admin/${destination} under no glyph this reader can find`);
      assert.equal(glyph, expected, `"${label}" goes to /admin/${destination}, which the sidemenu names with <${String(expected)}>`);
    });
  }
});
