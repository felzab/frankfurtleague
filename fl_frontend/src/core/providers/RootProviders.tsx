"use client";

import { useRouter } from "next/navigation";

import { ThemeProvider } from "next-themes";

import { RouterProvider } from "@heroui/react";

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
      {/* Without `disableTransitionOnChange` every `transition-colors` element eases its own colour
          when `data-theme` moves, and the flip is watchable. */}
      <ThemeProvider
        enableSystem={true}
        defaultTheme="dark"
        disableTransitionOnChange>
        <AppToaster />
        {children}
      </ThemeProvider>
    </RouterProvider>
  );
}
