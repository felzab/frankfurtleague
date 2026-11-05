import { createContext, useContext } from "react";

import type { Copy } from "@/core/copy";

/**
 * Why an editor's own acts cannot run now: its draft holds changes not yet saved. An act writes the record the draft
 * was made on, raising its version, so the draft's save would be turned away as stale, and it runs on the stored
 * values the boxes show changed. `EditorPage` provides it while the draft holds a change; every act inside it reads
 * it through `useLocked`.
 */
export const DraftUnsaved = createContext<Copy | undefined>(undefined);

/**
 * Why an act cannot run, every act alike: its `locked` reason, which the page read from the record as it stands, or,
 * inside an editor whose draft is unsaved, the draft's. The record's reason comes first: the draft's save would not
 * open the act. The act's button is then disabled and the reason stands in its line (`lockedLine`); `undefined`
 * while the act can run.
 */
export function useLocked(locked: Copy | undefined): Copy | undefined {
  const unsaved = useContext(DraftUnsaved);
  return locked ?? unsaved;
}
