"use client";

import Moon from "@gravity-ui/icons/Moon";
import Sun from "@gravity-ui/icons/Sun";
import { useTheme } from "next-themes";

import { ToggleButton, ToggleButtonGroup } from "@heroui/react";

import { useMounted } from "@/shared/hooks/useMounted";

import type { Key } from "@heroui/react";

/**
 * A segmented group rather than a switch, which is on or off and says nothing about what pressing it leads to.
 * **`useMounted` guards the first paint and must**: the resolved theme is not known until the client has it.
 */
export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const { setTheme, resolvedTheme } = useTheme();
  const mounted = useMounted();

  const selected = resolvedTheme === "dark" ? "dark" : "light";

  // `compact` keeps the menu row as tall as its neighbour: `.menu-item` floors a row and spends part of
  // that floor on its own padding, so a taller control here grows the row.
  const buttonSize = compact ? "h-6" : "h-8 w-8 sm:h-9 sm:w-9";

  return (
    <ToggleButtonGroup
      aria-label="Darstellungsmodus"
      size="sm"
      selectionMode="single"
      disallowEmptySelection
      isDisabled={!mounted}
      // Empty until mounted: an unknown theme must not render as "light chosen" and flip on hydration.
      selectedKeys={mounted ? [selected] : []}
      onSelectionChange={(keys: Set<Key>) => {
        const next = [...keys][0];
        if (next === "light" || next === "dark") setTheme(next);
      }}>
      <ToggleButton
        id="light"
        isIconOnly
        // `ToggleButtonGroup` is `h-auto`, so these buttons are the whole control's height. The width comes
        // with it, or an icon-only half ends up taller than it is wide.
        className={buttonSize}
        aria-label="Helle Darstellung">
        <Sun className="size-4" />
      </ToggleButton>
      <ToggleButton
        id="dark"
        isIconOnly
        className={buttonSize}
        aria-label="Dunkle Darstellung">
        <Moon className="size-4" />
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
