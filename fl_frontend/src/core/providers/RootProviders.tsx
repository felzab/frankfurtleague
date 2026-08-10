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
    // RouterProvider teaches react-aria's `href` props -- the topnav Dropdown.Items are the only
    // consumers -- to navigate through Next's client router. Without it react-aria falls back to
    // native <a> navigation, a full page reload on every menu link.
    <RouterProvider navigate={(href) => router.push(href)}>
      <ThemeProvider
        enableSystem={true}
        defaultTheme="dark">
        <AppToaster />
        {children}
      </ThemeProvider>
    </RouterProvider>
  );
}
