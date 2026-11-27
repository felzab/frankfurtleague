"use client";

import { useTheme } from "next-themes";
import { useIsSSR } from "react-aria/SSRProvider";

import { COPY } from "@/core/copy/shared";

import { GlyphChoices } from "./GlyphChoices";
import { tv } from "./tv";

import type { GlyphChoice } from "./GlyphChoices";

/** The themes as next-themes names them, each by its glyph, in the order the owner set: dark, light, system. */
const THEMES: readonly GlyphChoice[] = [
  { id: "dark", glyph: "dark", label: COPY.template.theme.dark },
  { id: "light", glyph: "light", label: COPY.template.theme.light },
  { id: "system", glyph: "system", label: COPY.template.theme.system },
];

/**
 * The theme: the three glyphs, each named by its tooltip, acting at once. A module of its own, so the classic frame,
 * whose footer sets it, brings none of the rail's menus.
 */
export function ThemeChoice() {
  const { theme, setTheme } = useTheme();
  // The server cannot read the theme next-themes stores in the browser, so its markup marks none, and a hydrating render
  // marking the stored one is a mismatch React does not repair: the page opened by its address showed none chosen. The
  // hydrating render draws what the server drew, and the render after marks the stored theme, the glyphs unmoved.
  const isSSR = useIsSSR();
  return (
    <GlyphChoices
      label={COPY.template.theme.label}
      choices={THEMES}
      value={isSSR ? null : (theme ?? null)}
      onChange={setTheme}
    />
  );
}

// Each place writes the row in its neighbours' words: the rail's foot as its „Konto“, the phone's sheet as its entries,
// and the classic footer as the © line beside it.
const row = tv({
  slots: {
    root: "flex items-center justify-between gap-3",
    label: "",
  },
  variants: {
    place: {
      // Collapsed, the rail is too narrow for the three glyphs: the row fades and leaves the focus order and the
      // accessibility tree, keeping its height, so nothing in the foot moves as the rail's width changes.
      rail: {
        root: "overflow-hidden px-3 text-sm whitespace-nowrap transition-[opacity,visibility] duration-(--motion-in) group-data-collapsed:invisible group-data-collapsed:opacity-0",
        label: "font-medium text-fg",
      },
      sheet: { root: "border-t border-border px-3 pt-3 text-base", label: "font-medium text-fg" },
      footer: { root: "text-xs", label: "text-fg-muted" },
    },
  },
});

/**
 * The theme for a visitor the frame draws signed out, as the account menu's foot sets it for a person signed in: one
 * row, „Darstellung“ at its start and the three glyphs at its end.
 */
export function ThemeRow({ place }: { place: "rail" | "sheet" | "footer" }) {
  const slots = row({ place });
  return (
    <div className={slots.root()}>
      <span className={slots.label()}>{COPY.template.theme.label}</span>
      <ThemeChoice />
    </div>
  );
}
