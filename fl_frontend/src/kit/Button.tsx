"use client";

import { Button as AriaButton } from "react-aria-components/Button";
import { ProgressBar } from "react-aria-components/ProgressBar";
import { tv } from "tailwind-variants/lite";

import { COPY } from "@/core/copy";

import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

import type { Copy } from "@/core/copy";
import type { IconName } from "./Icon";

type Act = {
  onPress?: () => void;
  type?: "button" | "submit";
  isDisabled?: boolean;
  /** The act is under way: a spinner joins the label, which stays as it is, and a press does nothing. */
  isBusy?: boolean;
};

type ButtonProps =
  | (Act & { variant: "primary" | "secondary" | "danger"; label: Copy; icon?: never })
  /** An icon alone: `label` is its name, which the tooltip shows. */
  | (Act & { icon: IconName; label: Copy; variant?: never });

const button = tv({
  // The border colour is named on every variant: HeroUI's base sheet colours every element's border.
  base: "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border text-sm font-medium whitespace-nowrap transition-colors duration-(--motion-state) data-disabled:opacity-50 pointer-coarse:h-11",
  variants: {
    look: {
      primary: "border-transparent bg-brand-solid px-4 text-on-brand data-hovered:bg-brand-solid-hover",
      secondary: "border-border-control bg-bg px-4 text-fg data-hovered:bg-bg-muted",
      danger: "border-transparent bg-danger px-4 text-on-brand data-hovered:bg-danger-solid-hover",
      icon: "w-9 border-transparent bg-transparent text-fg data-hovered:bg-bg-muted pointer-coarse:w-11",
    },
  },
});

function Spinner() {
  return (
    <ProgressBar
      isIndeterminate
      aria-label={COPY.shared.laedt}>
      <Icon
        glyph="laedt"
        size={16}
        spinning
      />
    </ProgressBar>
  );
}

/** The one control that acts: primary, secondary, danger, or an icon alone; disabled at half opacity. */
export function Button(props: ButtonProps) {
  const { onPress, type = "button", isDisabled = false, isBusy = false, label } = props;

  if (props.icon !== undefined) {
    return (
      <Tooltip label={label}>
        <AriaButton
          data-kit-focus="ring"
          type={type}
          onPress={onPress}
          isDisabled={isDisabled}
          isPending={isBusy}
          aria-label={label}
          className={button({ look: "icon" })}>
          {isBusy ? (
            <Spinner />
          ) : (
            <Icon
              glyph={props.icon}
              size={16}
            />
          )}
        </AriaButton>
      </Tooltip>
    );
  }

  return (
    <AriaButton
      data-kit-focus="ring"
      type={type}
      onPress={onPress}
      isDisabled={isDisabled}
      isPending={isBusy}
      className={button({ look: props.variant })}>
      {isBusy && <Spinner />}
      {label}
    </AriaButton>
  );
}
