"use client";

import { ThemeProvider } from "next-themes";

import { Toast } from "@heroui/react";

interface AppProvidersProps {
  children: React.ReactNode;
}
export default function RootProviders({ children }: AppProvidersProps) {
  return (
    <ThemeProvider
      enableSystem={true}
      defaultTheme="dark">
      <Toast.Provider />
      {children}
    </ThemeProvider>
  );
}
