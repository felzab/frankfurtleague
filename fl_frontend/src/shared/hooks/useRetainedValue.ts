"use client";

import { useState } from "react";

/**
 * Keeps the last non-null value so a closing overlay can finish its exit transition with its
 * content intact.
 *
 * Overlay state here is derived from the selected entity (`item !== null`), so clearing the
 * selection is what closes the modal. Rendering straight off that value blanks the dialog — or
 * unmounts it outright, which skips HeroUI's exit transition and reads as a hard flicker. Callers
 * render this retained value and drive `isOpen` from the live one.
 *
 * State rather than a ref: this feeds the render output, and a ref read during render is both a
 * lint error here and unsound under concurrent rendering. Adjusting state during render is React's
 * documented pattern for exactly this — React re-runs the component before committing, so no extra
 * paint is produced. https://react.dev/reference/react/useState#storing-information-from-previous-renders
 */
export function useRetainedValue<T>(value: T | null): T | null {
  const [retained, setRetained] = useState<T | null>(value);

  if (value !== null && value !== retained) setRetained(value);

  return value ?? retained;
}
