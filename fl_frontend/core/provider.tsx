"use client";

import { Toast } from "@heroui/react";
import { ThemeProvider } from "next-themes";

const Provider = ({ children }: { children: React.ReactNode }) => {
  return (
    <ThemeProvider
      enableSystem={true}
      defaultTheme="dark">
      <Toast.Provider />
      {children}
    </ThemeProvider>
  );
};

export default Provider;
