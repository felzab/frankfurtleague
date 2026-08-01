"use client";

import Moon from "@gravity-ui/icons/Moon";
import Sun from "@gravity-ui/icons/Sun";
import { useTheme } from "next-themes";

import { Switch } from "@heroui/react";

import { useMounted } from "@/shared/hooks/useMounted";

/**
 * No focus classes on the control, deliberately (R4 §5.3).
 *
 * `Switch.Control` is a plain `<span>`, so `focus-visible:` on it can never fire — the focusable
 * element is the hidden input. HeroUI already handles that: `.switch:focus-visible .switch__control`
 * rings the track in var(--focus) off the root's state. The old `ring-0 outline-none` here was
 * cancelling exactly that ring, which is why the switch had no focus indication at all.
 */
export function ThemeSwitch() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const mounted = useMounted();

  const handleToggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  if (!mounted) {
    return (
      <Switch
        aria-label="Darstellungsmodus umschalten"
        isSelected={false}>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch>
    );
  }

  return (
    <Switch
      aria-label="Darstellungsmodus umschalten"
      isSelected={theme === "light"}
      onChange={handleToggleTheme}>
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb>
            <Switch.Icon>
              {resolvedTheme === "dark" ? (
                <Moon
                  height={12}
                  width={12}
                  name=""
                />
              ) : (
                <Sun
                  strokeWidth={2}
                  height={12}
                  width={12}
                />
              )}
            </Switch.Icon>
          </Switch.Thumb>
        </Switch.Control>
      </Switch.Content>
    </Switch>
  );
}
