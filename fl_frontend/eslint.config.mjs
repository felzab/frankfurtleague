import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import jsxA11y from "eslint-plugin-jsx-a11y";
import { defineConfig, globalIgnores } from "eslint/config";

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
      // 'unsafe-inline' on script-src, so the CSP does not mitigate script injection (ADR-0011).
      "react/no-danger": "error",

      // Keeps type-only imports out of the runtime graph, so a client component importing a type
      // from a server-only module does not pull the module in with it.
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "separate-type-imports" }],

      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  // Layer boundaries, scoped to `core` and `shared` only: `admin` is a sanctioned aggregator slice,
  // so a blanket cross-feature ban would flag mostly-correct sites (ADR-0008).
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

  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/"]),
]);

export default eslintConfig;
