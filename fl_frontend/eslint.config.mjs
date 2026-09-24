import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import jsxA11y from "eslint-plugin-jsx-a11y";
import { defineConfig, globalIgnores } from "eslint/config";

const HERE = import.meta.dirname;

/**
 * Every file under `relative`, sorted and separator-normalised, so the digest below depends on the
 * tree rather than on the walk's order or the platform's path spelling. Empty where nothing is there,
 * which is what puts a directory's arrival in the digest.
 *
 * A recursive `readdirSync` rather than `globSync`: node's glob matches no dotfile and descends into
 * no dot-directory, so a stylesheet in either place would sit outside a key that has to cover it.
 */
function filesUnder(relative) {
  const absolute = path.join(HERE, relative);
  if (!existsSync(absolute)) {
    return [];
  }
  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(HERE, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

/**
 * What `pnpm lint --cache` must not answer past.
 *
 * eslint keys a cached verdict on the linted file and the resolved config alone -- `hashOfConfigFor`
 * in the installed eslint's lint-result cache. Three inputs decide a verdict from outside both, and
 * none of them moves that key on its own:
 *
 *   - the stylesheets `better-tailwindcss` resolves a class name against, `entryPoint` below being a
 *     path rather than the contents it names, so renaming a class in `globals.css` leaves every use
 *     of it cached clean;
 *   - the route files `@next/next/no-html-link-for-pages` reads off disk with `existsSync` and
 *     `readdirSync`, turning their names into the URLs an `<a href>` may not point at, so adding a
 *     page leaves an anchor that now names it cached clean;
 *   - the installed rule implementations, which `stringify` drops because they are functions, so a
 *     plugin bump changes what the rules say and not what the key covers.
 *
 * Hashing all three into `settings` puts them inside eslint's own key. `pnpm-lock.yaml` stands in for
 * the third: every version this tree resolves is in it, and nothing else names them all.
 *
 * Every stylesheet under `src/`, not the entry point alone: `admin.css` carries an `@reference` to
 * globals.css, and a set defined by a walk cannot fall behind a file someone adds.
 *
 * GROW THIS when a rule gains a cross-file input that is none of the three. The cache is a local
 * accelerator and never an authority: CI restores the pnpm store and never `node_modules`, where this
 * cache lives, so its run of this step re-decides every file (`docs/ops/spec.md` section 1.6), and a
 * miss here is a false green on a development machine that the pull request's own gate run then fails.
 */
const HASHED_CONTENTS = ["pnpm-lock.yaml", ...filesUnder("src").filter((file) => file.endsWith(".css"))];

/**
 * Names only, because names are all the route rule reads: it maps a file's path to a URL and never
 * opens it. The four roots are the ones it probes -- `<cwd>` and `<cwd>/src`, each with `app` and
 * `pages` -- and the extensions are the ones its own walk accepts.
 */
const HASHED_NAMES = ["app", "pages", "src/app", "src/pages"].flatMap(filesUnder).filter((file) => /\.[jt]sx?$/.test(file));

/**
 * Length-prefixed framing, so no two different input sets can feed the digest the same bytes: without
 * it a path and the contents behind it straddle each other's boundary and the pair is collidable.
 */
function feed(digest, ...parts) {
  for (const part of parts) {
    digest.update(`${Buffer.byteLength(part)}\n`).update(part);
  }
}

const digest = createHash("sha256");
for (const relative of HASHED_NAMES) {
  feed(digest, "name", relative);
}
for (const relative of HASHED_CONTENTS) {
  feed(digest, "content", relative, readFileSync(path.join(HERE, relative)));
}
const crossFileDigest = digest.digest("hex");

const LAYER_BOUNDARY = {
  core: {
    group: ["@/features/**", "@/shared/**", "**/features/**", "**/shared/**"],
    message: "core is infrastructure: it must not depend on shared or features.",
  },
  shared: {
    group: ["@/features/**", "**/features/**"],
    message: "shared must not import features. Inject via props/children (see Sidemenu.tsx:20).",
  },
};

/** Modules belonging to the suite alone, each message saying why; nothing else in the toolchain would say so. */
const TEST_ONLY = [
  {
    group: ["**/stdoutCapture.ts", "**/stdoutCapture"],
    message: "stdoutCapture replaces process.stdout.write: a *.test.ts(x) file may import it, production code may not.",
  },
  {
    group: ["**/authDoubles.ts", "**/authDoubles"],
    message:
      "authDoubles replaces the config, the database and the mail module for the process: a *.test.ts(x) file may import it, production code may not.",
  },
  {
    group: ["**/actionSources.ts", "**/actionSources", "**/schemeReader.ts", "**/schemeReader", "**/edgeRedaction.ts", "**/edgeRedaction"],
    message: "This module reads the source tree off disk: a *.test.ts(x) file may import it, production code may not.",
  },
];

const TEST_FILES = ["src/**/*.test.{ts,tsx}"];

/**
 * eslint decides `no-restricted-imports` from the LAST config object matching a file rather than
 * merging the matches, so a block covering a subset restates every pattern that reaches it.
 */
const restrictImports = (...patterns) => ({ "no-restricted-imports": ["error", { patterns: patterns }] });

// A syntax rule rather than a test sweep: two comments in this tree name `router.back()` without
// calling it, and a matcher over source text cannot tell them from a call. The exemption below is the
// one guarded site.
const HISTORY_BACK = {
  selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name="back"]',
  message: "A bare history back is a silent no-op on a cold entry. Use `goBackOrPush` or `BackButton` (docs/frontend/spec.md :: I225).",
};

// The name in every literal spelling -- a call, an alias, a destructured key, a computed member --
// since an alias reaches the endpoint with no call spelled. A name assembled at run time passes.
const PASSKEY_DELETION = {
  selector: 'Identifier[name="deletePasskey"], Literal[value="deletePasskey"], TemplateElement[value.cooked="deletePasskey"]',
  message:
    "The passkey plugin's own deletion writes outside the transaction a removal holds. Remove through `removePasskey` in src/core/auth.ts (docs/frontend/spec.md :: I312).",
};

const ASSERT_EQUALITY = 'CallExpression[callee.object.name="assert"][callee.property.name=/^(equal|strictEqual|deepEqual|deepStrictEqual)$/]';
const QUERY_NAME = "/^(query|get|find)(All)?By/";

const queryOperand = (index) =>
  ["callee.property.name", "callee.name"].flatMap((path) => [
    `[arguments.${index}.type="CallExpression"][arguments.${index}.${path}=${QUERY_NAME}]`,
    `[arguments.${index}.type="AwaitExpression"][arguments.${index}.argument.type="CallExpression"][arguments.${index}.argument.${path}=${QUERY_NAME}]`,
  ]);

/**
 * A failed equality serialises both operands, and a query's DOM node reaches the whole React tree: one
 * failing case exhausted the machine's memory. Literal shapes only: a node held in a variable passes.
 */
const QUERY_IN_EQUALITY = {
  selector: [...queryOperand(0), ...queryOperand(1)].map((operand) => `${ASSERT_EQUALITY}${operand}`).join(", "),
  message:
    "A failing equality serialises the whole rendered tree. Assert a boolean or a count instead: `assert.ok(<query> === null)`, or `<queryAll…>.length`.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react/no-unescaped-entities": "off",

      // Bans `dangerouslySetInnerHTML`. It is the compensating control for the CSP keeping
      // 'unsafe-inline' on script-src, so the CSP does not mitigate script injection.
      "react/no-danger": "error",

      // Keeps type-only imports out of the runtime graph, so a client component importing a type
      // from a server-only module does not pull the module in with it.
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "separate-type-imports" }],

      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],

      "no-restricted-syntax": ["error", HISTORY_BACK, PASSKEY_DELETION],
    },
  },

  // Layer boundaries, scoped to `core` and `shared` only: `admin` is a sanctioned aggregator slice,
  // so a blanket cross-feature ban would flag mostly-correct sites.
  { files: ["src/core/**/*.{ts,tsx}"], rules: restrictImports(LAYER_BOUNDARY.core) },
  { files: ["src/shared/**/*.{ts,tsx}"], rules: restrictImports(LAYER_BOUNDARY.shared) },

  // The test-only ban, which a `*.test.ts(x)` file alone escapes. Each block restates the boundary
  // above it for `restrictImports`'s reason.
  { files: ["src/**/*.{ts,tsx}"], ignores: TEST_FILES, rules: restrictImports(...TEST_ONLY) },
  { files: ["src/core/**/*.{ts,tsx}"], ignores: TEST_FILES, rules: restrictImports(...TEST_ONLY, LAYER_BOUNDARY.core) },
  { files: ["src/shared/**/*.{ts,tsx}"], ignores: TEST_FILES, rules: restrictImports(...TEST_ONLY, LAYER_BOUNDARY.shared) },

  // The one site the history ban exists to protect: it IS the guard, so it is the only place the
  // platform call belongs. Only that ban is lifted here.
  { files: ["src/shared/hooks/useEditorExit.ts"], rules: { "no-restricted-syntax": ["error", PASSKEY_DELETION] } },

  // A later block replaces an earlier one's options for the same rule, so the history ban is restated.
  // The deletion ban is not: `src/core/auth.test.ts` calls the plugin's deletion to hold it closed.
  { files: TEST_FILES, rules: { "no-restricted-syntax": ["error", HISTORY_BACK, QUERY_IN_EQUALITY] } },

  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "better-tailwindcss": betterTailwindcss },
    settings: {
      // `detectComponentClasses` picks up the `@layer components` classes in globals.css; without it
      // they report as unknown.
      "better-tailwindcss": { entryPoint: "src/app/globals.css", detectComponentClasses: true },
    },
    rules: {
      // Catches a class name that resolves to nothing. It is the only check in the toolchain that
      // can — tsc, the Prettier plugin and the browser all accept `bg-surface-muted` in silence.
      "better-tailwindcss/no-unknown-classes": "error",

      // Partial cover: it sees a literal abutting an interpolation, not two adjacent
      // interpolations. The convention is the real fix — put the separating space in the template
      // literal, never at the end of a class string.
      "better-tailwindcss/no-concatenated-classes": "error",
    },
  },

  // The a11y rule set. Only the rules are taken from the plugin: `eslint-config-next` already
  // registers it, and registering it twice is a flat-config error. Two violations remain, suppressed
  // at their sites with a reason.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: jsxA11y.flatConfigs.recommended.rules,
  },

  // No `files`, so it reaches every linted file and every cached verdict carries the digest.
  { settings: { crossFileInputs: crossFileDigest } },

  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/"]),
]);

export default eslintConfig;
