"use client";

import { Button } from "react-aria-components/Button";

import type { ReactNode } from "react";

/**
 * A row's name stretched over the row it stands in, as a row's `Link` is, for a row leading to a step of its page rather
 * than to an address. Its words keep their row's colour and their cut, the ring drawn inside the row.
 */
export function RowPress({ onPress, children }: { onPress: () => void; children: ReactNode }) {
  return (
    <Button
      data-kit-focus="row"
      onPress={onPress}
      className="max-w-full truncate text-start text-inherit after:absolute after:inset-0 after:content-['']">
      {children}
    </Button>
  );
}
