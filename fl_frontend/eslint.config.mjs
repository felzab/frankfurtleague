import { createHash } from "node:crypto";
import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import jsxA11y from "eslint-plugin-jsx-a11y";
import { defineConfig, globalIgnores } from "eslint/config";

/**
 * What `pnpm lint --cache` must not answer past.
 *
 * eslint keys a cached verdict on the linted file and the resolved config alone -- `hashOfConfigFor`
 * in the installed eslint's lint-result cache. Two inputs decide a verdict from outside both, and
 * neither moves that key on its own:
 *
 *   - the stylesheets `better-tailwindcss` resolves a class name against, `entryPoint` below being
 *     a path rather than the contents it names, so renaming a class in `globals.css` leaves every
 *     use of it cached clean;
 *   - the installed rule implementations, which `stringify` drops because they are functions, so a
 *     plugin bump changes what the rules say and not what the key covers.
 *
 * Hashing both into `settings` puts them inside eslint's own key. The lockfile stands in for the
 * second: every version this tree resolves is in it, and nothing else names them all.
 *
 * Every stylesheet under `src/`, not the entry point alone: `admin.css` carries `@reference` to
 * globals.css, and a set defined by a glob cannot fall behind a file someone adds.
 *
 * GROW THIS when a rule gains a cross-file input that is neither a stylesheet nor a package --
 * getting it wrong is silent, and what it costs is a check that has stopped checking.
 */
const CROSS_FILE_INPUTS = [
  "pnpm-lock.yaml",
  // Sorted and separator-normalised so the digest depends on the contents rather than on the
  // platform's path spelling or the walk's order.
  ...globSync("src/**/*.css", { cwd: import.meta.dirname })
    .map((relative) => relative.split(path.sep).join("/"))
    .sort(),
];

const crossFileDigest = CROSS_FILE_INPUTS.reduce(
  (digest, relative) => digest.update(relative).update(readFileSync(path.join(import.meta.dirname, relative))),
  createHash("sha256"),
).digest("hex");

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
    },
  },

  // Layer boundaries, scoped to `core` and `shared` only: `admin` is a sanctioned aggregator slice,
  // so a blanket cross-feature ban would flag mostly-correct sites.
  {
    files: ["src/core/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [LAYER_BOUNDARY.core] }] },
  },
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [LAYER_BOUNDARY.shared] }] },
  },

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
