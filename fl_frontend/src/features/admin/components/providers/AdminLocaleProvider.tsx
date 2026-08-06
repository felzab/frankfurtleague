"use client";

import { I18nProvider } from "@heroui/react";

import type { ReactNode } from "react";

/**
 * Pins react-aria's locale for every admin form control.
 *
 * Without it the number and date fields format from `useLocale`'s default — "en-US" during SSR, the
 * visitor's browser locale after hydration — so a Mietpreis server-rendered as "€80.00" flipped to
 * "80,00 €" on the first client render (a hydration mismatch, seen as React #418 in the console),
 * and an English-browser admin would keep US formats under a German UI. The site is German; its
 * fields are too.
 *
 * A client wrapper of its own because `I18nProvider` calls `createContext` at module scope: imported
 * directly into the server-component layout it evaluates in the RSC runtime and the build fails.
 */
export function AdminLocaleProvider({ children }: { children: ReactNode }) {
  return <I18nProvider locale="de-DE">{children}</I18nProvider>;
}
