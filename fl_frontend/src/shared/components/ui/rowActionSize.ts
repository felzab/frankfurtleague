/**
 * A row action is the tallest thing in an admin row, so this is what `AdminCrudFallback` reserves. **Its own module
 * rather than an export of `RowActions`**, which is `"use client"`: the server fallback would get a client reference.
 */
export const ROW_ACTION_SIZE = "h-10 w-10";
