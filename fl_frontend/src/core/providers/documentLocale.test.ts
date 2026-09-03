import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..");

/** Relative POSIX path → source text, for every component in the tree. */
const sources = new Map(
  filesUnder(SRC_DIR, (name) => name.endsWith(".tsx"), 200).map((file) => [
    path.relative(SRC_DIR, file).split(path.sep).join("/"),
    readFileSync(file, "utf8"),
  ]),
);

const mounts = [...sources].filter(([, text]) => text.includes("<I18nProvider")).map(([file]) => file);
const documents = [...sources].filter(([, text]) => /<html[\s>]/.test(text)).map(([file]) => file);

const pinnedLocale = (file: string): string | undefined => /<I18nProvider\s+locale="([^"]+)"/.exec(sources.get(file) ?? "")?.[1];
const declaredLang = (file: string): string | undefined => /<html\s[^>]*lang="([^"]+)"/.exec(sources.get(file) ?? "")?.[1];

describe("the document's locale", () => {
  // The one mount is what makes the rest of this file a statement about every route: react-aria
  // reads the NEAREST provider, so a second one is a subtree formatting dates by another calendar.
  it("is pinned exactly once, in the providers the root document renders", () => {
    assert.equal(mounts.length, 1, `expected one <I18nProvider> mount, found ${String(mounts.length)}: ${mounts.join(", ")}`);
    assert.ok(documents.length > 0, "no component renders <html>, so the sweep below proves nothing");

    for (const document of documents) {
      const mountedBy = mounts.filter((mount) => (sources.get(document) ?? "").includes(`<${path.basename(mount, ".tsx")}`));
      assert.deepEqual(mountedBy, mounts, `${document} renders <html> without reaching the locale pin in ${mounts.join(", ")}`);
    }
  });

  // Read from both sides rather than compared against a literal: what fails a visitor is the two
  // DISAGREEING — a de-DE pin under lang="en" is as wrong as an unpinned form under lang="de".
  it("is the language the document declares, so no field formats against `lang`", () => {
    // Pinned before the loop, which a sweep finding nothing would otherwise run zero times.
    assert.ok(mounts.length > 0, "no component mounts <I18nProvider>, so the comparison below runs on nothing");

    for (const mount of mounts) {
      const locale = pinnedLocale(mount);
      assert.ok(locale !== undefined, `${mount} mounts <I18nProvider> without a literal locale, so nothing here can check it`);

      for (const document of documents) {
        const lang = declaredLang(document);
        assert.ok(lang !== undefined, `${document} renders <html> without a lang attribute`);
        assert.equal(locale.split("-")[0], lang, `${mount} pins "${locale}" while ${document} declares lang="${lang}"`);
      }
    }
  });
});
