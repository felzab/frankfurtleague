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

  // `compact` is the menu-row height (owner, 2026-08-08): inside the sidemenu's options menu the h-8
  // desktop form made the Modus row taller than the Abmelden row beside it, and a menu row's height
  // should come from the menu, not from whichever control it happens to hold. h-7 everywhere there;
  // the bars keep the responsive pair below.
  const buttonHeight = compact ? "h-7" : "h-7 sm:h-8";

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
        // Shorter on a phone (owner, 2026-08-08). HeroUI's `size="sm"` toggle is `h-8`, which is right in a
        // desktop footer and taller than it needs to be in a mobile one, where the switch sits under the nav
        // and every vertical pixel is scrolled past. `h-7` below `sm`, HeroUI's own height from there up.
        className={buttonHeight}
        aria-label="Helle Darstellung">
        <Sun className="size-4" />
      </ToggleButton>
      <ToggleButton
        id="dark"
        isIconOnly
        className={buttonHeight}
        aria-label="Dunkle Darstellung">
        <Moon className="size-4" />
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
