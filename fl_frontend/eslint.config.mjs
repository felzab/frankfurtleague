import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import jsxA11y from "eslint-plugin-jsx-a11y";
import { defineConfig, globalIgnores } from "eslint/config";

// jsx-a11y still lights up against existing violations, so it stays `warn` until Wave 6 clears it.
// better-tailwindcss was flipped to `error` by Wave 5a and no longer goes through this helper.
const asWarnings = (rules) =>
  Object.fromEntries(Object.entries(rules).map(([rule, value]) => [rule, Array.isArray(value) ? ["warn", ...value.slice(1)] : "warn"]));

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react/no-unescaped-entities": "off",
      // The targeted half of the Posture B decision (ledger R3b-S9.1b). The enforced CSP keeps
      // 'unsafe-inline' on script-src, so it does not mitigate script injection -- this does, at
      // the only place injection could realistically enter this codebase. Measured at 0 existing
      // violations, so it lands as `error` directly. If you ever genuinely need raw HTML, that is
      // the moment to reconsider a nonce-based CSP, not the moment to disable this rule.
      "react/no-danger": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "separate-type-imports",
        },
      ],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // Layer boundaries (audit R2 §2.4). Scoped to `core` and `shared` only — `admin` is a
  // sanctioned aggregator slice, so a blanket cross-feature ban would flag 47 sites of
  // which 44 are correct. See CLAUDE.md §9 A7.
  {
    files: ["src/core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/**", "@/shared/**", "**/features/**", "**/shared/**"],
              message: "core is infrastructure: it must not depend on shared or features.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/**", "**/features/**"],
              message: "shared must not import features. Inject via props/children (see Sidemenu.tsx:20).",
            },
          ],
        },
      ],
    },
  },

  // R4 Phase 0.1 — catches unresolvable utilities such as `bg-surface-muted` (R4 §6.3), a bug
  // class invisible to tsc, ESLint and the Tailwind Prettier plugin. Rule was named
  // `no-unregistered-classes` when R4 was written; it is `no-unknown-classes` in v4.x.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "better-tailwindcss": betterTailwindcss },
    settings: {
      // detectComponentClasses picks up the `@layer components` classes in globals.css
      // (soccer-field-base, corner-arc-*, penalty-area-*); without it they report as unknown.
      "better-tailwindcss": { entryPoint: "src/app/globals.css", detectComponentClasses: true },
    },
    rules: {
      // `error` as of Wave 5a. It is the only check in the toolchain that can see a class name
      // resolving to nothing -- tsc, the Tailwind Prettier plugin and the browser all accept
      // `bg-surface-muted` (R4 §6.3) and `animate-appearance-in` (a HeroUI v2 utility that did not
      // survive v3) in silence, and both shipped.
      "better-tailwindcss/no-unknown-classes": "error",
    },
  },

  // R4 Phase 0.2 — eslint-config-next already registers the `jsx-a11y` plugin (and enables 8 of its
  // rules), so re-registering it is a flat-config error. Only the rule set is taken from here; the
  // direct devDependency is what pins the version this list is derived from.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: asWarnings(jsxA11y.flatConfigs.recommended.rules),
  },

  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/"]),
]);

export default eslintConfig;
