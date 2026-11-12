import { createContext, useContext } from "react";

/**
 * Whether the form around a field is closed read-only, as an editor is on a record its season no longer lets
 * change: `EditorPage` provides it, and every kit field reads it, so a closed editor disables each of its
 * fields without a page passing `isDisabled` to each.
 */
export const FormClosed = createContext(false);

/** A field's disabled state: its own, or its form's closed state. */
export function useDisabled(isDisabled: boolean): boolean {
  return useContext(FormClosed) || isDisabled;
}
