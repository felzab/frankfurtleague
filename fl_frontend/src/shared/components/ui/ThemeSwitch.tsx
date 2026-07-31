"use client";

import Moon from "@gravity-ui/icons/Moon";
import Sun from "@gravity-ui/icons/Sun";
import { useTheme } from "next-themes";

import { Switch } from "@heroui/react";

import useMounted from "@/shared/hooks/useMounted";

/**
 * The focus affordance has to be driven from the root, not the control (R4 §5.3).
 *
 * `Switch.Control` is a plain `<span>` (HeroUI 3.2.2, `switch.js`) — the focusable element is the
 * hidden input, so `focus-visible:` on the control can never fire, which is why `ring-0
 * outline-none` there left the switch with no focus indication at all. react-aria puts
 * `data-focus-visible` on the Switch root instead (react-aria-components 1.19, `Switch.mjs`), so the
 * root is the `group` and the track's border reacts to it. The border is transparent at rest and the
 * box is `border-box`, so it costs no layout.
 */
const SWITCH_CONTROL = "group-data-[focus-visible=true]:border-brand rounded-full border border-transparent ring-0 outline-none";

export default function ThemeSwitch() {
  const _toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  const { theme, setTheme, resolvedTheme } = useTheme();
  const mounted = useMounted();

  if (!mounted) {
    return (
      <Switch
        aria-label="Darstellungsmodus umschalten"
        className="group"
        isSelected={false}>
        <Switch.Control className={SWITCH_CONTROL}>
          <Switch.Thumb />
        </Switch.Control>
      </Switch>
    );
  }

  return (
    <Switch
      aria-label="Darstellungsmodus umschalten"
      className="group"
      isSelected={theme === "light"}
      onChange={_toggleTheme}>
      <Switch.Content>
        <Switch.Control className={SWITCH_CONTROL}>
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
