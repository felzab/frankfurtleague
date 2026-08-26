import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..", "..", "..");

const CONTROL = "SaisonDateField";
const CONTROL_MODULE = "features/saisons/components/forms/SaisonFormControls.tsx";

/**
 * The props that pair. `rangeMessage` carries a default, so a bound arriving without it type-checks,
 * lints and builds, and the field then answers a broken bound with a sentence naming no bound at all.
 */
const BOUNDS = ["minValue", "maxValue"] as const;
const MESSAGE = "rangeMessage";

/** Tests are left out because this file is one: the sweep below would otherwise read its own literals. */
function collectSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectSources(full);
    if (/\.test\.tsx?$/.test(entry.name)) return [];

    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

const sources = new Map(
  collectSources(SRC_DIR).map((file) => [path.relative(SRC_DIR, file).split(path.sep).join("/"), readFileSync(file, "utf8")]),
);

/** One rendered date field: which of the paired props it spells, and what to call it in a failure. */
type Site = {
  file: string;
  /** The payload path the field writes, which is what an admin reading the message is standing in. */
  name: string;
  /** Separates two fields writing one path, which a form branching on its shape renders. */
  ariaLabel: string;
  attributes: Set<string>;
  /** A spread hides the props from the sweep, so a site carrying one is reported rather than passed. */
  hasSpread: boolean;
};

function sitesIn(file: string, text: string): Site[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sites: Site[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;

      if (opening.tagName.getText(source) === CONTROL) {
        const attributes = new Set<string>();
        let hasSpread = false;
        const literals = new Map<string, string>();

        for (const attribute of opening.attributes.properties) {
          if (!ts.isJsxAttribute(attribute)) {
            hasSpread = true;
            continue;
          }
          const spelt = attribute.name.getText(source);
          attributes.add(spelt);

          const initializer = attribute.initializer;
          if (initializer !== undefined && ts.isStringLiteral(initializer)) literals.set(spelt, initializer.text);
        }

        sites.push({
          file,
          // The line only where the name is not a literal: it moves under an edit anywhere above it.
          name: literals.get("name") ?? `line ${String(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)}`,
          ariaLabel: literals.get("ariaLabel") ?? "",
          attributes,
          hasSpread,
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return sites;
}

const sites = [...sources].flatMap(([file, text]) => sitesIn(file, text));

const boundsOf = (site: Site): string[] => BOUNDS.filter((bound) => site.attributes.has(bound));

/**
 * The payload path alone where it is unique in its file, and the field's own aria label beside it
 * where it is not: a form branching on its shape renders one path from two places, and a report
 * naming only the path would say the same thing about either.
 */
function idOf(site: Site): string {
  const shared = sites.filter((other) => other.file === site.file && other.name === site.name).length > 1;

  return `${site.file} :: ${site.name}${shared ? ` (${site.ariaLabel})` : ""}`;
}

describe("the bound a date field sets and the sentence that states it", () => {
  it("found the fields and the props to pair at all", () => {
    // Floors rather than a count: a rename that silently matched nothing would leave every case
    // below vacuously true, and the pairing is exactly what a rename is most likely to drop.
    assert.ok(sites.length >= 6, `expected at least 6 ${CONTROL} sites, found ${String(sites.length)}`);
    assert.ok(
      sites.some((site) => boundsOf(site).length > 0),
      `no ${CONTROL} site carries a bound — the sweep no longer reads them`,
    );

    // The component's own vocabulary, so a prop renamed there is named here rather than surfacing as
    // a call site that appears to have dropped its sentence.
    const declared = sources.get(CONTROL_MODULE) ?? "";
    for (const prop of [...BOUNDS, MESSAGE]) {
      assert.ok(declared.includes(prop), `${CONTROL_MODULE} no longer declares ${prop}`);
    }
  });

  it("spells every date field's props where the pairing can read them", () => {
    const spread = sites.filter((site) => site.hasSpread).map(idOf);

    assert.deepEqual(spread, [], `${spread.join(", ")} passes props through a spread, so the pairing cannot be checked`);
  });

  for (const site of sites.filter((site) => boundsOf(site).length > 0)) {
    it(`${idOf(site)} states the bound it sets`, () => {
      assert.ok(
        site.attributes.has(MESSAGE),
        `${idOf(site)} sets ${boundsOf(site).join(" and ")} without a ${MESSAGE}. rangeOverflow and rangeUnderflow then ` +
          `render the generic default, which names neither the bound nor why the day is refused.`,
      );
    });
  }

  it("writes no range sentence where no bound can raise it", () => {
    // The other half of the pairing: `rangeMessage` is reachable only through rangeOverflow and
    // rangeUnderflow, which a field setting no bound can never report.
    const unreachable = sites.filter((site) => site.attributes.has(MESSAGE) && boundsOf(site).length === 0).map(idOf);

    assert.deepEqual(unreachable, [], `${unreachable.join(", ")} writes a ${MESSAGE} the field can never render`);
  });
});
