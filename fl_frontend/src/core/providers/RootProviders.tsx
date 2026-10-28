// Mounted from a client component because `I18nProvider` creates its context at module scope, which
// the RSC runtime refuses and the root layout is.
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { ThemeProvider, useTheme } from "next-themes";

// Session 8: both come from `react-aria-components` once HeroUI goes; the kit's menu links follow this
// `RouterProvider`.
import { I18nProvider, RouterProvider } from "@heroui/react/rac";

import { THEME_COLOR } from "@/core/themeColor";

import { AppToaster } from "./AppToaster";

// React Aria's documented typing of a link's `routerOptions`: Next's own navigation options, and
// `replace` for a step the browser's Back should skip, such as a season switch.
declare module "react-aria-components" {
  interface RouterConfig {
    routerOptions: { replace?: boolean; scroll?: boolean };
  }
}

/**
 * The browser bar in the theme the visitor chose, as shadcn/ui's own site sets it (`useMetaColor`): the
 * layout's `<meta name="theme-color">` follows the system's scheme alone, and next-themes leaves it be, so a
 * visitor choosing „Hell“ on a dark system would keep a dark bar over a light page. Read from the theme's
 * name rather than from the token, since next-themes sets `data-theme` in its own effect, after this one.
 */
function ThemeColor() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    // One `<meta>` per scheme; whichever the browser applies shows the chosen theme's colour.
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute("content", THEME_COLOR[resolvedTheme]);
  }, [resolvedTheme]);
  return null;
}

interface AppProvidersProps {
  children: React.ReactNode;
}
export function RootProviders({ children }: AppProvidersProps) {
  const router = useRouter();

  return (
    // Without it react-aria's `href` props fall back to native <a> navigation, a full page reload
    // on every menu link.
    <RouterProvider
      navigate={(href, { replace = false, ...options } = {}) => (replace ? router.replace(href, options) : router.push(href, options))}>
      {/* Here because the document declares its language here:
          unpinned, react-aria formats "en-US" under SSR and the browser's locale after hydration,
          so a date field asks mm/dd/yyyy and reorders its segments mid-session. */}
      <I18nProvider locale="de-DE">
        {/* Without `disableTransitionOnChange` every `transition-colors` element eases its own colour
            when `data-theme` moves, and the flip is watchable. */}
        {/* `system` spelled out although it is today's default: next-themes has changed that default
            before, and the site follows the visitor's system. */}
        <ThemeProvider
          enableSystem={true}
          defaultTheme="system"
          disableTransitionOnChange>
          {/* Redesign: goes with the last importer of `shared/utils/appToast`. */}
          <AppToaster />
          <ThemeColor />
          {children}
        </ThemeProvider>
      </I18nProvider>
    </RouterProvider>
  );
}
