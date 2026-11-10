// Mounted from a client component because `I18nProvider` creates its context at module scope, which
// the RSC runtime refuses and the root layout is.
"use client";

import { ThemeProvider } from "next-themes";
import { I18nProvider } from "react-aria-components/I18nProvider";

import type { ReactNode } from "react";

export function RootProviders({ children }: { children: ReactNode }) {
  return (
    // Here because the document declares its language here: unpinned, react-aria formats "en-US" under SSR
    // and the browser's locale after hydration, so a date field asks mm/dd/yyyy and reorders its segments
    // mid-session.
    <I18nProvider locale="de-DE">
      {/* Without `disableTransitionOnChange` every `transition-colors` element eases its own colour
          when `data-theme` moves, and the flip is watchable. */}
      {/* `system` spelled out although it is today's default: next-themes has changed that default
          before, and the site follows the visitor's system. */}
      <ThemeProvider
        enableSystem={true}
        defaultTheme="system"
        disableTransitionOnChange>
        {children}
      </ThemeProvider>
    </I18nProvider>
  );
}
