"use client";

import { useId, useRef } from "react";

import { Button as AriaButton } from "react-aria-components/Button";
import { ProgressBar } from "react-aria-components/ProgressBar";
import { useInteractOutside } from "react-aria/useInteractOutside";

import { COPY } from "@/core/copy";

import { buttonLook } from "./buttonStyles";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";
import { useOpenUntilHidden } from "./useOpenUntilHidden";

import type { Copy } from "@/core/copy";
import type { ReactElement, RefObject } from "react";
import type { IconName } from "./Icon";

type Act = {
  onPress?: () => void;
  type?: "button" | "submit";
  /** The act is under way: a spinner joins the label, which stays as it is, and a press does nothing. */
  isBusy?: boolean;
  /** `close` closes the dialog or the sheet the button stands in, through React Aria's slot for it. */
  slot?: "close";
  /**
   * Why the act cannot run on the record as it stands: dimmed but reachable, its reason shown by `LockedReason`, and
   * `onPress` never called. It stands instead of a dialog's trigger, never as one: React Aria's press responders
   * merge, so a press would open the dialog as well as the reason. Wins over `isDisabled`, since it can say why.
   */
  locked?: Copy;
  /** The edge the reason opens from: an act's at a row's end unless it stands at a column's start. */
  lockedEdge?: "start" | "end";
};

type ButtonProps =
  | (Act & {
      variant: "primary" | "secondary" | "danger" | "dangerOutline" | "quiet";
      label: Copy;
      /** Closed for input still missing, which the fields beside it show; an act with a reason of its own is `locked`. */
      isDisabled?: boolean;
      /** A glyph before the label, such as the filter's; the spinner takes its place while busy. */
      leadingIcon?: IconName;
      icon?: never;
      /** The id of the words that describe the act, such as the notice a form's send rests on (`OneShotForm`). */
      "aria-describedby"?: string;
    })
  /**
   * An icon alone: `label` is its name, which the tooltip shows. One folding a region, such as the rail,
   * says whether that region stands open and names it by its id. It closes by
   * `locked` alone: a disabled trigger's tooltip never opens, React Aria's `useFocusable` dropping what the trigger
   * hands it, and an icon without its tooltip says nothing.
   */
  | (Act & {
      icon: IconName;
      label: Copy;
      variant?: never;
      leadingIcon?: never;
      isDisabled?: never;
      "aria-expanded"?: boolean;
      "aria-controls"?: string;
    });

function Spinner() {
  return (
    <ProgressBar
      isIndeterminate
      aria-label={COPY.shared.loading}>
      <Icon
        glyph="loading"
        size={16}
        spinning
      />
    </ProgressBar>
  );
}

/** What a locked button's reason hands it: the press answering with the reason, and the button a press outside it leaves. */
type ReasonPress = { ref: RefObject<HTMLButtonElement | null>; onPress: () => void };

/**
 * A locked act's reason, the one tooltip every way it opens: the pointer resting on the button or the keys' focus, as
 * any tooltip opens, and a press or a tap, which React Aria's tooltip leaves to its holder since a touch raises none. A
 * press opens it at once, or keeps the one the pointer raised, and a second press, Escape or leaving closes it; a tap
 * has no leaving of its own, so a press outside stands for it. A tooltip's description lasts only while it is open, so
 * the sentence also stands unseen for the button's `aria-describedby`, read on every visit.
 */
function LockedReason({
  reason,
  reasonId,
  edge,
  children,
}: {
  reason: Copy;
  reasonId: string;
  edge: "start" | "end";
  children: (press: ReasonPress) => ReactElement;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [isOpen, setOpen] = useOpenUntilHidden();
  const isHeld = useRef(false);
  const onOpenChange = (open: boolean) => {
    if (!open) isHeld.current = false;
    setOpen(open);
  };
  const onPress = () => {
    isHeld.current = !isHeld.current;
    setOpen(isHeld.current);
  };
  const close = () => onOpenChange(false);
  // At the press's start too: the hook's own end waits on a click, which a phone's tap on nothing need not send.
  useInteractOutside({ ref, isDisabled: !isOpen, onInteractOutside: close, onInteractOutsideStart: close });
  return (
    <>
      <Tooltip
        label={reason}
        placement={`top ${edge}`}
        held={{ isOpen, onOpenChange }}>
        {children({ ref, onPress })}
      </Tooltip>
      <span
        id={reasonId}
        hidden>
        {reason}
      </span>
    </>
  );
}

/**
 * The one control that acts: primary, secondary, danger, outlined danger, quiet, or an icon alone; disabled at half
 * opacity.
 * A labelled button may lead with a glyph.
 */
export function Button(props: ButtonProps) {
  const { onPress, type = "button", isDisabled = false, isBusy = false, label, slot, locked, lockedEdge = "end" } = props;
  const reasonId = useId();
  const isLocked = locked !== undefined;
  // `aria-disabled` rather than `isDisabled`: a native `disabled` takes the focus and the hover the reason opens on. A
  // submit button is a plain one while locked, or the form's Enter and the press would send it.
  const act = {
    type: isLocked ? "button" : type,
    slot,
    onPress: isLocked ? undefined : onPress,
    isDisabled: !isLocked && isDisabled,
    isPending: isBusy,
    "aria-disabled": isLocked || undefined,
  } as const;
  const described = (given?: string) => (isLocked ? [given, reasonId].filter((id) => id !== undefined).join(" ") : given);

  const draw = (press?: ReasonPress) =>
    props.icon !== undefined ? (
      <AriaButton
        data-kit-focus="ring"
        {...act}
        {...press}
        aria-label={label}
        aria-expanded={props["aria-expanded"]}
        aria-controls={props["aria-controls"]}
        aria-describedby={described()}
        className={buttonLook({ look: "icon", host: "aria", locked: isLocked })}>
        {isBusy ? (
          <Spinner />
        ) : (
          <Icon
            glyph={props.icon}
            size={16}
          />
        )}
      </AriaButton>
    ) : (
      <AriaButton
        data-kit-focus="ring"
        {...act}
        {...press}
        aria-describedby={described(props["aria-describedby"])}
        className={buttonLook({ look: props.variant, host: "aria", locked: isLocked })}>
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

  if (locked !== undefined)
    return (
      <LockedReason
        reason={locked}
        reasonId={reasonId}
        edge={lockedEdge}>
        {draw}
      </LockedReason>
    );
  return props.icon !== undefined ? <Tooltip label={label}>{draw()}</Tooltip> : draw();
}
