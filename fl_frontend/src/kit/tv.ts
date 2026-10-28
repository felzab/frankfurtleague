import { createTV } from "tailwind-variants";

/**
 * Every kit recipe's builder: tailwind-variants' default build, whose merger resolves two of a recipe's
 * classes setting one property, a base's and a variant's, to the later one. The merger knows a closed list of
 * names in some of Tailwind's namespaces, so the theme's own names there are taught to it here: unknown, a
 * `max-w-form` beside a `max-w-full` would both stay for the stylesheet's order to pick, and `shadow-menu`
 * would be read as a shadow colour and dropped beside a real one. `tv.test.ts` holds the lists to `tokens.css`.
 */
export const tv = createTV({
  twMergeConfig: {
    extend: {
      theme: {
        container: ["popover", "signin", "question", "card", "dialog", "form", "classic", "content"],
        shadow: ["menu", "dialog"],
        tracking: ["display", "caps"],
      },
    },
  },
});
