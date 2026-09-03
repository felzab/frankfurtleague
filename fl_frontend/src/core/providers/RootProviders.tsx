// Mounted from a client component because `I18nProvider` creates its context at module scope, which
// the RSC runtime refuses and the root layout is.
"use client";

import { useRouter } from "next/navigation";

import { ThemeProvider } from "next-themes";

import { I18nProvider, RouterProvider } from "@heroui/react";

import { AppToaster } from "./AppToaster";

interface AppProvidersProps {
  children: React.ReactNode;
}
export function RootProviders({ children }: AppProvidersProps) {
  const router = useRouter();

  return (
    // Without it react-aria's `href` props fall back to native <a> navigation, a full page reload
    // on every menu link.
    <RouterProvider navigate={(href) => router.push(href)}>
      {/* Here because the document declares its language here (`docs/frontend/spec.md :: I41`):
          unpinned, react-aria formats "en-US" under SSR and the browser's locale after hydration,
          so a date field asks mm/dd/yyyy and reorders its segments mid-session. */}
      <I18nProvider locale="de-DE">
        {/* Without `disableTransitionOnChange` every `transition-colors` element eases its own colour
            when `data-theme` moves, and the flip is watchable. */}
        <ThemeProvider
          enableSystem={true}
          defaultTheme="dark"
          disableTransitionOnChange>
          <AppToaster />
          {children}
        </ThemeProvider>
      </I18nProvider>
    </RouterProvider>
  );
}
