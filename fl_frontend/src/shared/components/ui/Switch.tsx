"use client";

import { Switch as HeroUISwitch } from "@heroui/react/switch";

import { useRequiredMark } from "./RequiredMarks";

import type { SwitchRootProps } from "@heroui/react/switch";

/** HeroUI's switch, required exactly where its form's schema refuses it left off. */
function SwitchRoot(props: Omit<SwitchRootProps, "isRequired">) {
  return (
    <HeroUISwitch
      {...props}
      isRequired={useRequiredMark(props.name, false)}
    />
  );
}

export const Switch = Object.assign(SwitchRoot, {
  Content: HeroUISwitch.Content,
  Control: HeroUISwitch.Control,
  Thumb: HeroUISwitch.Thumb,
  Icon: HeroUISwitch.Icon,
});
