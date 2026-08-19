"use client";

import { I18nProvider } from "@heroui/react";

import type { ReactNode } from "react";

/**
 * Pins react-aria's locale: otherwise fields format "en-US" under SSR and the browser's locale after
 * hydration, a React #418 mismatch. A client wrapper because `I18nProvider` calls
 * `createContext` at module scope, which the RSC runtime rejects.
 */
export function AdminLocaleProvider({ children }: { children: ReactNode }) {
  return <I18nProvider locale="de-DE">{children}</I18nProvider>;
}
