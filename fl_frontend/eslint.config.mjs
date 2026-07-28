import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import jsxA11y from "eslint-plugin-jsx-a11y";
import { defineConfig, globalIgnores } from "eslint/config";

// Both new plugins light up against existing violations, so they land as `warn` and are
// flipped to `error` by the wave that clears them (better-tailwindcss: Wave 5a, jsx-a11y: Wave 6).
const asWarnings = (rules) =>
  Object.fromEntries(Object.entries(rules).map(([rule, value]) => [rule, Array.isArray(value) ? ["warn", ...value.slice(1)] : "warn"]));

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react/no-unescaped-entities": "off",
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
      "better-tailwindcss/no-unknown-classes": "warn",
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
