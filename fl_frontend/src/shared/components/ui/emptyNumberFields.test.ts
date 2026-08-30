import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

function collectTsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(full);

    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

/**
 * **Found by the CONTROL, never by how the empty case is spelled.** Grepping for `isNaN` finds only the sites
 * already written that way, so `?? 0` or `|| 0` would each be a silent member — and one was.
 */
const RENDERS_A_NUMBER_FIELD = /<NumberField(?![\w.])/;

/** The one rule. Enumerated above by the control, asserted here by the mechanism — never the same property. */
const RECORDS_NOT_ENTERED = /enteredNumber\(/;

const sources = new Map(
  collectTsxFiles(SRC_DIR).map((file) => [path.relative(SRC_DIR, file).split(path.sep).join("/"), readFileSync(file, "utf8")]),
);

const numberFieldFiles = [...sources].filter(([, text]) => RENDERS_A_NUMBER_FIELD.test(text)).map(([file]) => file);

describe("what every number field records when it is emptied", () => {
  it("is discovered by the control it renders", () => {
    // The anti-vacuity clause: a discriminator that stopped matching would leave the assertions below
    // true of an empty list, which is the one failure a sweep cannot report about itself.
    assert.ok(numberFieldFiles.length >= 9, `expected at least 9 number fields, found ${String(numberFieldFiles.length)}`);
  });

  for (const file of numberFieldFiles) {
    it(`${file} records every one of its emptied boxes as nothing entered`, () => {
      // COUNTED, not merely present: two number fields and one call still match a presence check while the
      // other field substitutes a number. `0` is a number typed; `null` is nobody typing one.
      const text = sources.get(file) ?? "";
      const fields = (text.match(new RegExp(RENDERS_A_NUMBER_FIELD.source, "g")) ?? []).length;
      const recorded = (text.match(new RegExp(RECORDS_NOT_ENTERED.source, "g")) ?? []).length;

      assert.ok(recorded >= fields, `${file} renders ${String(fields)} number fields but records only ${String(recorded)}`);
    });
  }
});
