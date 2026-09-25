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
  ["number-field", /Render a number field through/],
  ["number-field-load", /Load HeroUI's number field through/],
  ["native-form", /never a native <form>/],
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
  ["site-origin", /SITE_URL is the published origin/],
  ["locale-provider", /The locale is pinned once/],
  ["locale-load", /Import react-aria.s primitives statically/],
  ["node-module", /a `createRequire` function held in a name/],
  ["test-only", /a \*\.test\.ts\(x\) file may import it, production code may not/],
  ["test-only-load", /loaded at run time stays the suite's/],
  ["hint-internals-load", /Load the popover or the panel through Hint/],
  ["layer-core-load", /An `import\(\)` in core is an import/],
  ["layer-shared-load", /An `import\(\)` in shared is an import/],
  ["class-constant-name", /is named `\*_CLASSES`/],
  ["transition-rewrap", /wrap it in another `startTransition`/],
  ["toast-failure", /Hand an action's failure to `appToast\.failure`/],
  ["uncached-read", /This module caches no read/],
  ["logged-error", /Hand `logger\.error` `undefined`/],
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

const syntaxMessages = (rules) => new Set((rules?.["no-restricted-syntax"] ?? []).slice(1).map((ban) => ban.message));

/**
 * Each file a syntax ban exempts, which is a block of its own naming one path, with the bans it
 * escapes: the ones a sibling path in its directory and population is held to and it is not.
 */
const exemptions = await Promise.all(
  config
    .filter((block) => block.files?.length === 1 && !/[*{]/.test(block.files[0]) && block.rules?.["no-restricted-syntax"] !== undefined)
    .map(async ({ files: [file] }) => {
      const sibling = path.posix.join(
        path.posix.dirname(file),
        `zzExemptionCheck${isTestPath(file) ? ".test" : ""}${path.posix.extname(file)}`,
      );
      const own = syntaxMessages((await eslint.calculateConfigForFile(path.join(HERE, file))).rules);
      const held = syntaxMessages((await eslint.calculateConfigForFile(path.join(HERE, sibling))).rules);
      const [result] = await eslint.lintText(readFileSync(path.join(HERE, file), "utf8"), { filePath: path.join(HERE, sibling) });
      const reported = new Set(result.messages.map((message) => message.message));
      return { file, escaped: [...held].filter((message) => !own.has(message)), reported };
    }),
);

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

  // A block restating a ban can drop it unseen by a plant linted in another block, and a plant is
  // linted in the block whose whole entry, severity included, eslint resolves for its path.
  it("every block stating a ban has a plant linted in it, marking each ban it restates", () => {
    const gaps = statements.flatMap(({ block, index, rule, stated, keys }) => {
      const linted = plants.filter((plant) => isDeepStrictEqual(resolved.get(plant.name)?.[rule], stated));
      const marked = new Set(linted.flatMap((plant) => [...markedIn(plant)]));
      // The syntax blocks come from two populations, production and test, narrowed by scope and exemption:
      // each ban needs a plant of each population it reaches, and each block one marked ban for what its
      // reach and exemption get wrong.
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

  // An exemption outliving its reason would excuse the next file written at that path unseen.
  it("every exempt file still spells what it is exempt from", () => {
    assert.ok(exemptions.length > 0, "no exempt file found: the reader of the exemption blocks has lost them");
    const stale = exemptions.flatMap(({ file, escaped, reported }) =>
      escaped.filter((message) => !reported.has(message)).map((message) => `${file}: ${keyOf(message)}`),
    );
    assert.deepEqual(stale, []);
  });
});
