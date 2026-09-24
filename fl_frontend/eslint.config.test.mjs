import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { isDeepStrictEqual } from "node:util";

import { ESLint } from "eslint";

import config from "./eslint.config.mjs";

const HERE = import.meta.dirname;
const PLANTS = path.join(HERE, "eslint-plants");

/**
 * A config's selectors have no `RuleTester`: these plants are that harness, so a selector edited
 * later is driven red on every run rather than once.
 */
const BANS = [
  ["admin-link", /An admin link carries/],
  ["hover-opacity", /never an opacity/],
  ["hover-alpha", /never a tint of one/],
  ["gap", /A gap is one of/],
  ["link-decoration", /rather than spelling its underline/],
  ["brand-grade", /BRAND_INK_OUTSIDE_PROSE_CLASSES/],
  ["muted-hint", /Wear `muted-hint`/],
  ["BRAND_TILE", /Take `BRAND_TILE_CLASSES`/],
  ["BRAND_ICON_BUTTON", /Take `BRAND_ICON_BUTTON_CLASSES`/],
  ["SHORTHAND_CHIP", /Take `SHORTHAND_CHIP_CLASSES`/],
  ["muted-meta", /Wear `muted-meta`/],
  ["dot", /laufendDot/],
  ["neutral-pill", /never the neutral pair/],
  ["season-empty", /SeasonEmptyState/],
  ["numeric-pair", /go together/],
  ["vh", /dvh/],
  ["auth-request", /auth\.api/],
  ["resend", /provider's endpoint/],
  ["stale-path", /moved off \/bestaetigung/],
  ["relative-nav", /relative one resolves/],
  ["history-back", /bare history back/],
  ["view-facets", /builds its facets itself/],
  ["view-props", /An admin view destructures its props/],
  ["date-bound", /A bound goes on the Calendar/],
  ["date-spread", /Prop spreading is forbidden/],
  ["date-alias", /Import a date control under its own name/],
  ["heading", /Render `PanelHeading`/],
  ["hint-nest", /read out as part of the title/],
  ["next-private", /Mount Next's contexts/],
  ["next-private-load", /Load Next's contexts through/],
  ["next-private-string", /Name Next's private contexts in/],
  ["segmented-import", /Compose a date or time field/],
  ["segmented-load", /Load a segmented date control through/],
  ["calendar-load", /Import the Calendar statically/],
  ["heroui-form", /Render a form through/],
  ["hint-internals", /Render a hint through Hint or InfoHint/],
  ["vendor-root", /Import (?:a HeroUI component|an icon) from its own subpath/],
  ["vendor-root-load", /An `import\(\)` of a package root/],
  ["heroui-form-load", /Load HeroUI's form through/],
  ["passkey-deletion", /passkey plugin's own deletion/],
  ["query-in-equality", /serialises the whole rendered tree/],
  ["facets-server", /cannot hand across to a client/],
  ["invite-refusal", /No undo route replays/],
  ["layer-core", /core is infrastructure/],
  ["layer-shared", /shared must not import features/],
  ["test-only", /a \*\.test\.ts\(x\) file may import it, production code may not/],
  ["test-only-load", /A test-only module loaded at run time/],
  ["hint-internals-load", /Load the popover or the panel through Hint/],
  ["layer-core-load", /An `import\(\)` in core is an import/],
  ["layer-shared-load", /An `import\(\)` in shared is an import/],
  ["class-constant-name", /is named `\*_CLASSES`/],
  ["transition-rewrap", /wrap it in another `startTransition`/],
  ["unknown-class", /^Unknown class detected/],
  ["unused-disable", /^Unused eslint-disable directive/],
];

const keyOf = (message) => BANS.find(([, pattern]) => pattern.test(message))?.[0] ?? `UNKNOWN: ${message}`;

/** Each plant, with the path under `src/` its first line says it is linted as: a ban's scope is a path. */
const plants = readdirSync(PLANTS)
  .filter((name) => name.endsWith(".txt"))
  .sort()
  .map((name) => {
    const text = readFileSync(path.join(PLANTS, name), "utf8");
    return { name, text, lintedAs: /^\/\/ Linted as (src\/\S+)\.\n/.exec(text)?.[1] };
  });

const marksOf = (text) =>
  text.split("\n").flatMap((line, index) => [...line.matchAll(/expect: ([\w-]+)/g)].map((match) => `${index + 1} ${match[1]}`));

const markedIn = (plant) => new Set(marksOf(plant.text).map((mark) => mark.split(" ")[1]));

const SEVERITIES = { off: 0, warn: 1, error: 2 };

/** A rule's entry as eslint resolves it for a file: the severity as its number, then the options. */
function normalised(entry) {
  const [severity, ...options] = Array.isArray(entry) ? entry : [entry];
  return [typeof severity === "number" ? severity : SEVERITIES[severity], ...options];
}

/** The rules whose options are bans, each reading the messages a block's options state. */
const BAN_RULES = {
  "no-restricted-syntax": (options) => options.map((ban) => ban.message),
  "no-restricted-imports": (options) => options.flatMap((option) => option.patterns.map((pattern) => pattern.message)),
  "no-restricted-properties": (options) => options.map((ban) => ban.message),
  "react/forbid-component-props": (options) => options.flatMap((option) => option.forbid.map((ban) => ban.message)),
  // The rule's own message, which no option carries.
  "react/jsx-props-no-spreading": () => ["Prop spreading is forbidden"],
  // A rule the config defines states its ban in its own messages.
  ...Object.fromEntries(
    config.flatMap(({ plugins = {} }) =>
      Object.entries(plugins.local?.rules ?? {}).map(([name, rule]) => [`local/${name}`, () => Object.values(rule.meta.messages)]),
    ),
  ),
};

/** Every block stating a ban, with the rule, its normalised entry and the keys of what it states. */
const statements = config.flatMap((block, index) =>
  Object.entries(BAN_RULES).flatMap(([rule, messagesOf]) => {
    if (block.rules?.[rule] === undefined) return [];
    const stated = normalised(block.rules[rule]);
    return stated[0] === 0 ? [] : [{ block, index, rule, stated, keys: [...new Set(messagesOf(stated.slice(1)).map(keyOf))] }];
  }),
);

const isTestPath = (file) => /\.test\.tsx?$/.test(file);

const eslint = new ESLint({ cwd: HERE });
const reports = new Map();
const resolved = new Map();
for (const plant of plants) {
  if (plant.lintedAs === undefined) continue;
  resolved.set(plant.name, (await eslint.calculateConfigForFile(path.join(HERE, plant.lintedAs))).rules);
  const [result] = await eslint.lintText(plant.text, { filePath: path.join(HERE, plant.lintedAs) });
  // A warning never matches a mark: `pnpm lint` fails on one only through `--max-warnings 0`, which
  // an editor's lint or a bare `eslint .` does not pass.
  reports.set(
    plant.name,
    result.messages.map(
      (message) =>
        `${message.line} ${message.fatal === true ? "FATAL" : `${message.severity === 2 ? "" : "WARNING "}${keyOf(message.message)}`}`,
    ),
  );
}

describe("the lint bans, driven against planted source", () => {
  for (const plant of plants) {
    it(`${plant.name}: every mark is reported on its line with its ban, and nothing else is`, () => {
      assert.ok(plant.lintedAs, `${plant.name} opens with no "// Linted as src/..." line`);
      assert.deepEqual(reports.get(plant.name).sort(), marksOf(plant.text).sort());
    });
  }

  it("every ban the config states is planted", () => {
    const keys = statements.flatMap((statement) => statement.keys);
    if (config.some(({ linterOptions }) => linterOptions?.reportUnusedDisableDirectives === "error")) {
      keys.push(keyOf("Unused eslint-disable directive"));
    }
    const unplanted = [...new Set(keys)].filter((key) => !plants.some((plant) => markedIn(plant).has(key)));
    assert.deepEqual(unplanted, []);
  });

  // Each block restating a ban is one more place to drop it, which a plant resolving to another block
  // never sees. A plant is linted in a block when eslint resolves that block's whole entry, severity
  // included, for its path: a block restating another's options at `warn` is a block of its own.
  it("every block stating a ban has a plant linted in it, marking each ban it restates", () => {
    const gaps = statements.flatMap(({ block, index, rule, stated, keys }) => {
      const linted = plants.filter((plant) => isDeepStrictEqual(resolved.get(plant.name)?.[rule], stated));
      const marked = new Set(linted.flatMap((plant) => [...markedIn(plant)]));
      // The syntax blocks are generated from two populations, the production bans and the test bans, then
      // narrowed by scope and exemption. Each ban is marked by a plant of each population it reaches, and
      // each block by one marked ban, which is what its own reach and exemption can get wrong.
      const markedInPopulation = (population) =>
        new Set(plants.filter((plant) => isTestPath(plant.lintedAs ?? "") === population).flatMap((plant) => [...markedIn(plant)]));
      const missing =
        rule === "no-restricted-syntax" && keys.some((key) => marked.has(key))
          ? [...new Set(linted.map((plant) => isTestPath(plant.lintedAs)))].flatMap((population) => {
              const populationMarks = markedInPopulation(population);
              return keys.filter((key) => !populationMarks.has(key)).map((key) => `${key} (no ${population ? "test" : "production"} plant)`);
            })
          : keys.filter((key) => !marked.has(key));
      return missing.length === 0 ? [] : [`${rule}, block ${index} (${JSON.stringify(block.files)}): ${missing.join(", ")}`];
    });
    assert.deepEqual(gaps, []);
  });
});
