"use client";

import { useRef } from "react";

import { Button } from "react-aria-components/Button";

import { useFocusHome } from "./RowActs";

import type { ReactNode } from "react";

/**
 * A row's name stretched over the row it stands in, as a row's `Link` is, for a row leading to a step of its page rather
 * than to an address. Its words keep their row's colour and their cut, the ring drawn inside the row. A row its own
 * dialog's act leaves opening nothing, such as a squad row taken out, hands the focus on as a removed row does.
 */
export function RowPress({ onPress, children }: { onPress: () => void; children: ReactNode }) {
  const press = useRef<HTMLButtonElement>(null);
  useFocusHome(press);
  return (
    <Button
      ref={press}
      data-kit-focus="row"
      onPress={onPress}
      className="max-w-full truncate text-start text-inherit after:absolute after:inset-0 after:content-['']">
      {children}
    </Button>
  );
}
