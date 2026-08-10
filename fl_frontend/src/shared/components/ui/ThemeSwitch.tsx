"use client";

import Moon from "@gravity-ui/icons/Moon";
import Sun from "@gravity-ui/icons/Sun";
import { useTheme } from "next-themes";

import { ToggleButton, ToggleButtonGroup } from "@heroui/react";

import { useMounted } from "@/shared/hooks/useMounted";

import type { Key } from "@heroui/react";

/**
 * The appearance control: two options, sun and moon, one of them always chosen.
 *
 * **A segmented group rather than a switch, because a switch answers the wrong question.** A switch
 * is on or off, so it can only be read as "dark mode: on" — which means the label and the state have
 * to be inferred from each other, and the control says nothing about what pressing it leads to. Two
 * labelled options say what both states are and which one is current, which is what makes it legible
 * at a glance in a bar rather than needing a caption beside it.
 *
 * `disallowEmptySelection` is what makes it a choice rather than a pair of toggles: pressing the
 * option that is already chosen keeps it, instead of clearing to a state the theme does not have.
 *
 * **`useMounted` guards the first paint, and it must.** The resolved theme is not known on the
 * server — it comes from `localStorage` and the OS preference — so rendering the real selection
 * during hydration is a mismatch. Until mounted the group is rendered disabled with neither option
 * pressed, which reserves the exact same box and cannot claim a state it does not know yet.
 */
export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const { setTheme, resolvedTheme } = useTheme();
  const mounted = useMounted();

  const selected = resolvedTheme === "dark" ? "dark" : "light";

  // `compact` is the menu-row height (decided 2026-08-08): inside the sidemenu's options menu a
  // taller control makes the Modus row outgrow the Abmelden row beside it, and a row's height comes
  // from the menu, not from whichever control it holds.
  const buttonSize = compact ? "h-7" : "h-8 w-8 sm:h-9 sm:w-9";

  return (
    <ToggleButtonGroup
      aria-label="Darstellungsmodus"
      size="sm"
      selectionMode="single"
      disallowEmptySelection
      isDisabled={!mounted}
      // Empty until mounted: an unknown theme must not render as "light chosen", which would flip
      // under the user on hydration.
      selectedKeys={mounted ? [selected] : []}
      onSelectionChange={(keys: Set<Key>) => {
        const next = [...keys][0];
        if (next === "light" || next === "dark") setTheme(next);
      }}>
      <ToggleButton
        id="light"
        isIconOnly
        // The size a segmented control is given elsewhere, a step up on a wider viewport (decided
        // 2026-08-10). On the button because `ToggleButtonGroup` is `h-auto`; the width comes with
        // it, or an icon-only half ends up taller than it is wide.
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
