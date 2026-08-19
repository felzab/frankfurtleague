"use client";

import { useState } from "react";

/**
 * Keeps the last non-null value so a closing overlay finishes its exit intact. Render this and drive `isOpen` from
 * the live value — using the retained one for both leaves the overlay open.
 */
export function useRetainedValue<T>(value: T | null): T | null {
  const [retained, setRetained] = useState<T | null>(value);

  if (value !== null && value !== retained) setRetained(value);

  return value ?? retained;
}
