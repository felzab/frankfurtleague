"use client";

import { useTheme } from "next-themes";
import Moon from "@gravity-ui/icons/Moon";
import Sun from "@gravity-ui/icons/Sun";
import { Switch } from "@heroui/react";
import useMounted from "@/shared/hooks/useMounted";

export default function ThemeSwitch() {
  const _toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  const { theme, setTheme, resolvedTheme } = useTheme();
  const mounted = useMounted();

  if (!mounted) {
    return (
      <Switch isSelected={false}>
        <Switch.Control className="ring-0 outline-none">
          <Switch.Thumb />
        </Switch.Control>
      </Switch>
    );
  }

  return (
    <Switch
      aria-label="Modus switch"
      isSelected={theme === "light"}
      onChange={_toggleTheme}>
      <Switch.Content>
        <Switch.Control className="ring-0 outline-none">
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
