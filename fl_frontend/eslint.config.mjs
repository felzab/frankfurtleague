import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tailwind from "eslint-plugin-tailwindcss";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...tailwind.configs["flat/recommended"],
  {
    plugins: {
      tailwindcss: tailwind,
    },
    rules: {
      "react/no-unescaped-entities": "off",
      "@next/next/no-page-custom-font": "off",

      // Tailwind specific tweaks
      "tailwindcss/classnames-order": "off",
      "tailwindcss/no-custom-classname": "off", // Essential for Hero UI v3 custom data attributes
    },
    settings: {
      tailwindcss: {
        config: false,
      },
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/",
  ]),
]);

export default eslintConfig;
