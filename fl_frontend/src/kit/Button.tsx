"use client";

import { Button as AriaButton } from "react-aria-components/Button";
import { ProgressBar } from "react-aria-components/ProgressBar";

import { COPY } from "@/core/copy";

import { buttonLook } from "./buttonStyles";
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
  /** `close` closes the dialog or the sheet the button stands in, through React Aria's slot for it. */
  slot?: "close";
};

type ButtonProps =
  | (Act & {
      variant: "primary" | "secondary" | "danger" | "quiet";
      label: Copy;
      /** A glyph before the label, such as the filter's; the spinner takes its place while busy. */
      leadingIcon?: IconName;
      icon?: never;
    })
  /** An icon alone: `label` is its name, which the tooltip shows. */
  | (Act & { icon: IconName; label: Copy; variant?: never; leadingIcon?: never });

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

/**
 * The one control that acts: primary, secondary, danger, quiet, or an icon alone; disabled at half opacity.
 * A labelled button may lead with a glyph.
 */
export function Button(props: ButtonProps) {
  const { onPress, type = "button", isDisabled = false, isBusy = false, label, slot } = props;

  if (props.icon !== undefined) {
    return (
      <Tooltip label={label}>
        <AriaButton
          data-kit-focus="ring"
          type={type}
          slot={slot}
          onPress={onPress}
          isDisabled={isDisabled}
          isPending={isBusy}
          aria-label={label}
          className={buttonLook({ look: "icon", host: "aria" })}>
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
      slot={slot}
      onPress={onPress}
      isDisabled={isDisabled}
      isPending={isBusy}
      className={buttonLook({ look: props.variant, host: "aria" })}>
      {isBusy ? (
        <Spinner />
      ) : (
        props.leadingIcon !== undefined && (
          <Icon
            glyph={props.leadingIcon}
            size={16}
          />
        )
      )}
      {label}
    </AriaButton>
  );
}
