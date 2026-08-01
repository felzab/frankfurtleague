/**
 * SHARED · configured `tv`
 *
 * The app's only entry point to `tailwind-variants`. It exists to register the `--text-fluid-*` scale
 * with tailwind-merge; without that, a recipe combining a fluid size with a text colour silently
 * renders with no colour. `eslint.config.mjs` restricts the raw import so every recipe comes through
 * here.
 */

import { createTV } from "tailwind-variants";

/**
 * `tv`, told about this app's font-size scale.
 *
 * **Import this, never `tv` from `tailwind-variants` directly** — `eslint.config.mjs` enforces it.
 *
 * `tv` resolves conflicting classes with tailwind-merge, which decides what `text-*` means from the
 * value: `text-sm` is a font size, `text-brand` is a colour. It cannot know that `--text-fluid-*` in
 * `globals.css` defines nine more font sizes, so unregistered it files `text-fluid-xs` as a COLOUR —
 * the same conflict group as `text-brand-solid-foreground`. Last one wins, and a recipe applying a
 * size variant after a colour variant then renders with no colour at all, falling back to
 * `--fg-base`. That failure is invisible in the dark theme, where `--fg-base` is white, and is
 * 1.97:1 in the light theme on a brand fill.
 *
 * Registering the scale puts `text-fluid-*` in the `font-size` group, where a size and a colour stop
 * competing. **Add to this list in the same change that adds a `--text-fluid-*` token** — an
 * unlisted size resurfaces the conflict, and nothing fails except the rendered colour.
 */
export const tv = createTV({
  twMergeConfig: {
    extend: {
      classGroups: {
        "font-size": [
          {
            text: ["fluid-xxs", "fluid-xs", "fluid-sm", "fluid-base", "fluid-lg", "fluid-xl", "fluid-2xl", "fluid-3xl", "fluid-4xl"],
          },
        ],
      },
    },
  },
});
