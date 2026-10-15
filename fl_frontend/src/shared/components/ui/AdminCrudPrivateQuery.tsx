"use client";

import { createContext, useContext, useDeferredValue, useMemo, useState } from "react";

import type { ReactNode } from "react";

type PrivateQuery = { value: string; set: (value: string) => void };

/** `null` outside the shell, which holds every admin search, and never a fallback to the URL (`docs/frontend/spec.md :: I680`). */
const PrivateQueryContext = createContext<PrivateQuery | null>(null);

/**
 * Mounted by `AdminCrudShell` around both halves of every admin search. Held here, the query reaches
 * no request line, so nginx's access log cannot keep it.
 */
export function AdminCrudPrivateQuery({ children }: { children: ReactNode }) {
  const [value, setValue] = useState("");
  // On the value alone: a fresh object per render re-renders the list under it on every keystroke.
  const held = useMemo(() => ({ value: value, set: setValue }), [value]);

  return <PrivateQueryContext.Provider value={held}>{children}</PrivateQueryContext.Provider>;
}

export function useCrudSearchField(): { inputValue: string; setInputValue: (value: string) => void } {
  const held = useContext(PrivateQueryContext);
  // Loud rather than a bar typing into nothing: outside the shell nothing would hold what is typed.
  if (held === null) throw new Error("AdminCrudSearch renders inside AdminCrudShell, which holds what it types.");

  return { inputValue: held.value, setInputValue: held.set };
}

/**
 * The list's half, reading whatever the bar above the Suspense boundary wrote. The two are siblings
 * joined by nothing else, which is why the held value travels as context rather than as a prop.
 */
export function useCrudListQuery(): string {
  // Deferred, so a keystroke commits the bar before a table thousands of rows long re-renders behind it.
  // A list with no holder has no bar either, and reads no query.
  return useDeferredValue(useContext(PrivateQueryContext)?.value ?? "");
}
