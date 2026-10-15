"use client";

import { createContext, useContext, useMemo, useState } from "react";

import type { ReactNode } from "react";

type PrivateQuery = { value: string; set: (value: string) => void };

/**
 * What a half mounted outside the shell reads: no query, and a bar typing into nothing. Never the
 * URL, the one place a typed query must not reach (`docs/frontend/spec.md :: I680`).
 */
const UNHELD: PrivateQuery = { value: "", set: () => undefined };

const PrivateQueryContext = createContext<PrivateQuery>(UNHELD);

/**
 * Mounted by `AdminCrudShell` around both halves of every admin search. Held here, the query reaches
 * no request line, so neither nginx's access log nor `aktionen.request` can keep it.
 */
export function AdminCrudPrivateQuery({ children }: { children: ReactNode }) {
  const [value, setValue] = useState("");
  // On the value alone: a fresh object per render re-renders the list under it on every keystroke.
  const held = useMemo(() => ({ value: value, set: setValue }), [value]);

  return <PrivateQueryContext.Provider value={held}>{children}</PrivateQueryContext.Provider>;
}

export function useCrudSearchField(): { inputValue: string; setInputValue: (value: string) => void } {
  const held = useContext(PrivateQueryContext);

  return { inputValue: held.value, setInputValue: held.set };
}

/**
 * The list's half, reading whatever the bar above the Suspense boundary wrote. The two are siblings
 * joined by nothing else, which is why the held value travels as context rather than as a prop.
 */
export function useCrudListQuery(): string {
  return useContext(PrivateQueryContext).value;
}
