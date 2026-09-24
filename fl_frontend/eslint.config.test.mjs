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
  ["heading", /Render `PanelHeading`/],
  ["hint-nest", /read out as part of the title/],
  ["next-private", /Mount Next's contexts/],
  ["segmented-import", /Compose a date or time field/],
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

/** A rule's options follow its severity; a block turning a rule `"off"` carries none. */
const optionsOf = (entry) => (Array.isArray(entry) ? entry.slice(1) : []);

/** The rules whose options are bans, each reading the messages a block's options state. */
const BAN_RULES = {
  "no-restricted-syntax": (options) => options.map((ban) => ban.message),
  "no-restricted-imports": (options) => options.flatMap((option) => option.patterns.map((pattern) => pattern.message)),
  "no-restricted-properties": (options) => options.map((ban) => ban.message),
  "react/forbid-component-props": (options) => options.flatMap((option) => option.forbid.map((ban) => ban.message)),
  // The rule's own message, which no option carries.
  "react/jsx-props-no-spreading": () => ["Prop spreading is forbidden"],
};

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
    const messages = config.flatMap(({ rules = {} }) =>
      Object.entries(BAN_RULES).flatMap(([rule, messagesOf]) => {
        const options = optionsOf(rules[rule]);
        return options.length === 0 ? [] : messagesOf(options);
      }),
    );
    if (config.some(({ linterOptions }) => linterOptions?.reportUnusedDisableDirectives === "error")) {
      messages.push("Unused eslint-disable directive");
    }
    const unplanted = [...new Set(messages.map(keyOf))].filter((key) => !plants.some((plant) => markedIn(plant).has(key)));
    assert.deepEqual(unplanted, []);
  });

  // Each block restating a ban is one more place to drop it, which a plant resolving to another block
  // never sees; a plant is linted in a block when eslint resolves that block's options for its path.
  it("every block stating a ban has a plant linted in it, marking each ban it restates", () => {
    const gaps = config.flatMap((block, index) =>
      Object.entries(BAN_RULES).flatMap(([rule, messagesOf]) => {
        const stated = optionsOf(block.rules?.[rule]);
        if (stated.length === 0) return [];
        const keys = [...new Set(messagesOf(stated).map(keyOf))];
        const marked = new Set(
          plants
            .filter((plant) => isDeepStrictEqual(optionsOf(resolved.get(plant.name)?.[rule]), stated))
            .flatMap((plant) => [...markedIn(plant)]),
        );
        // The syntax blocks are one generator's output over `SOURCE_BANS`, so a ban reaches all of them or
        // none; what one gets wrong alone is its reach and its exemption, which one marked ban drives.
        const missing = rule === "no-restricted-syntax" && keys.some((key) => marked.has(key)) ? [] : keys.filter((key) => !marked.has(key));
        return missing.length === 0 ? [] : [`${rule}, block ${index} (${JSON.stringify(block.files)}): ${missing.join(", ")}`];
      }),
    );
    assert.deepEqual(gaps, []);
  });
});
