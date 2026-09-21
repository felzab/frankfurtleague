"use client";

import { createContext, useContext, useMemo, useState } from "react";

import { useDebouncedUrlQuery } from "../../hooks/useDebouncedUrlQuery";
import { useUrlQuery } from "../../hooks/useUrlQuery";

import type { ReactNode } from "react";

/** What the URL holds on every other admin list, held in the page instead. */
type PrivateQuery = { value: string; set: (value: string) => void };

/** `null` is the ordinary admin list, where the two halves below meet through `?q=` as they always have. */
const PrivateQueryContext = createContext<PrivateQuery | null>(null);

/**
 * Mounted by `AdminCrudShell` around both halves of the search, for a resource an administrator
 * would type a person's address into. Held here, that value reaches no request line, so neither
 * nginx's access log nor `aktionen.request` can keep it.
 */
export function AdminCrudPrivateQuery({ children }: { children: ReactNode }) {
  const [value, setValue] = useState("");
  // On the value alone: a fresh object per render re-renders the list under it on every keystroke.
  const held = useMemo(() => ({ value: value, set: setValue }), [value]);

  return <PrivateQueryContext.Provider value={held}>{children}</PrivateQueryContext.Provider>;
}

/**
 * The bar's half. Both hooks run on every render because a hook cannot be called on a condition, and
 * the URL one is told whether it may write: its effect IS the navigation a private page must not make.
 */
export function useCrudSearchField(): { inputValue: string; setInputValue: (value: string) => void } {
  const held = useContext(PrivateQueryContext);
  const url = useDebouncedUrlQuery({ writesTheUrl: held === null });

  if (held === null) return { inputValue: url.inputValue, setInputValue: url.setInputValue };

  return { inputValue: held.value, setInputValue: held.set };
}

/**
 * The list's half, reading whatever the bar above the Suspense boundary wrote. The two are siblings
 * joined by nothing else, which is why the held value travels as context rather than as a prop.
 */
export function useCrudListQuery(): string {
  const held = useContext(PrivateQueryContext);
  const fromUrl = useUrlQuery();

  return held?.value ?? fromUrl;
}
