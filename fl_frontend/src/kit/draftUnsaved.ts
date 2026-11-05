import { createContext, useContext } from "react";

import type { Copy } from "@/core/copy";

/**
 * Why an editor's own acts cannot run now: its draft holds changes not yet saved. An act writes the record the draft
 * was made on, raising its version, so the draft's save would be turned away as stale, and it runs on the stored
 * values the boxes show changed. `EditorPage` provides it while the draft holds a change; its danger rows and every
 * `SectionAct` inside it read it, each closed with this reason in its own line.
 */
export const DraftUnsaved = createContext<Copy | undefined>(undefined);

/** The reason an editor's acts are closed while its draft is unsaved, `undefined` while it holds no change. */
export function useDraftUnsaved(): Copy | undefined {
  return useContext(DraftUnsaved);
}
