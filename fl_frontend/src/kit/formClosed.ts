import { createContext } from "react";

/**
 * Whether the form around a field is closed read-only, as an editor is on a record its season no longer lets
 * change: `EditorPage` provides it, and every kit field reads it through `useFieldLock`, so a closed editor makes each
 * of its fields read-only without a page passing a lock to each.
 */
export const FormClosed = createContext(false);
