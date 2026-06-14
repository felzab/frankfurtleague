"use client";

import { Toast } from "@heroui/react";
import { ThemeProvider } from "next-themes";

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
