"use client";

import { useSyncExternalStore } from "react";

import { useTheme } from "next-themes";

import { THEME_COLOR } from "@/core/themeColor";

const neverChanges = () => () => undefined;

/**
 * The browser bar in the theme the visitor chose: one `<meta name="theme-color">` per system scheme, which
 * React hoists into the head and the root layout, mounted once for the session, keeps. Not the layout's
 * `viewport`: Next remounts the route's head on every client navigation, which would put each scheme's own
 * colour back under a chosen theme. The server cannot read the choice next-themes stores in the browser, so
 * its markup and the render hydrating it give each scheme its own colour, and a chosen theme takes both metas
 * once the page runs: a hoisted `<meta>` hydrating with other content is added beside the server's, which
 * stays first and wins.
 */
export function ThemeColor() {
  const { theme } = useTheme();
  const hydrated = useSyncExternalStore(
    neverChanges,
    () => true,
    () => false,
  );
  const chosen = hydrated && (theme === "light" || theme === "dark") ? theme : undefined;
  return (["light", "dark"] as const).map((scheme) => (
    <meta
      key={scheme}
      name="theme-color"
      media={`(prefers-color-scheme: ${scheme})`}
      content={THEME_COLOR[chosen ?? scheme]}
    />
  ));
}
