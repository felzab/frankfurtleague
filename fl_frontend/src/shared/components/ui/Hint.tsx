"use client";

import { useEffect, useId, useLayoutEffect, useRef } from "react";

import { Description } from "@heroui/react/description";
import { Popover } from "@heroui/react/popover";

import { useHoverOpenOverlay } from "@/shared/hooks/useHoverOpenOverlay";

import { HINT_SURFACE_CLASSES } from "./hintSurface";
import { HintPanel, HintPopover } from "./InfoHint";
import { overlayPanel } from "./overlayPanel";

import type { ReactNode, RefObject } from "react";

type HintPoint = { term?: string; text: string };

// The scale is spelled out and not `muted-hint`, which is `fluid-sm`: this paragraph sits under a control and
// pairs with the same sentence on a mirrored panel, where two type steps apart read as two designs.
const FIELD_HINT_CLASSES = "fluid-xxs text-foreground-muted leading-normal font-medium";

/** A lead and four bullets, together about 350 characters. Longer is a document, not a popover. */
type HintBody = {
  /**
   * **Says what the thing is or does, in the league's words.** No justification, no mechanism, no
   * derivation: the reader runs a school football league, not this system.
   * `docs/frontend/spec.md` §1.12 holds the whole standard.
   */
  lead: string;
  /**
   * **One sentence each, four at most.** Cut what the interface already carries, what follows from
   * what the reader knows, and what this panel's banner says: a banner is what this save does, a
   * hint the rule that stands whatever is typed.
   */
  points?: readonly HintPoint[];
};

type HintProps =
  /**
   * A child of the field it explains, as react-aria's description slot: the field names it in its own
   * `aria-describedby`, which a hint placed anywhere else never reaches. In the flow, so mounting one
   * on a keystroke shifts the layout.
   */
  | { mode: "field"; text: string }
  /**
   * Beside a control that cannot hold it, publishing the `id` that control carries in `aria-describedby`.
   * Each site names why the control cannot.
   */
  | { mode: "inline"; text: string; describes: string }
  /**
   * For a hint that owns its own press. A control that owns one keeps `IconTooltip`, whose panel a
   * modal popover would steal the press of.
   */
  | { mode: "reveal"; label: string; body: HintBody; trigger?: ReactNode }
  /**
   * A refusal is not capped here: `validation.ts :: VALIDATION_FAILED` sets its register, which
   * allows the second sentence that names the way out.
   */
  | {
      mode: "refusal";
      reason: string | null;
      /**
       * **The wrapped control's accessible name at rest, containing its visible words.** It names the one tab stop, found
       * by speech input through those words (WCAG 2.5.3); an `aria-label` saying more is passed whole, or closing the
       * control loses the rest.
       */
      label: string;
      className?: string;
      children: ReactNode;
    };

/**
 * **No severity, deliberately.** A hint written where a blocking banner was owed would never reach
 * the save gate, which `resolveBlockingBanners` opens only for a consequence the pending save causes.
 * Grade one in the editor's `banners.ts` instead.
 */
export function Hint(props: HintProps) {
  if (props.mode === "field")
    return (
      <Description
        elementType="p"
        className={FIELD_HINT_CLASSES}>
        {props.text}
      </Description>
    );

  if (props.mode === "inline")
    return (
      <p
        id={props.describes}
        className={FIELD_HINT_CLASSES}>
        {props.text}
      </p>
    );

  if (props.mode === "refusal")
    return (
      <RefusalHint
        reason={props.reason}
        label={props.label}
        className={props.className}>
        {props.children}
      </RefusalHint>
    );

  return (
    <RevealHint
      label={props.label}
      body={props.body}
      trigger={props.trigger}
    />
  );
}

/** The capped body, in the popover `InfoHint` opens too. */
function RevealHint({ label, body, trigger }: { label: string; body: HintBody; trigger?: ReactNode }) {
  return (
    <HintPopover
      label={label}
      trigger={trigger}
      panelClassName={`${overlayPanel()} fluid-xs text-foreground flex w-max max-w-88 flex-col gap-y-2 p-4 leading-normal font-medium outline-none`}>
      <p>{body.lead}</p>
      {body.points !== undefined && body.points.length > 0 && (
        <ul className="flex flex-col gap-y-1">
          {body.points.map((point) => (
            <li key={point.text}>
              {point.term !== undefined && (
                <>
                  <strong className="font-bold">{point.term}</strong>{" "}
                </>
              )}
              {point.text}
            </li>
          ))}
        </ul>
      )}
    </HintPopover>
  );
}

/**
 * **Laid over the control, never wrapped around it**: a popover trigger hands its `id` and `aria-expanded` to every
 * pressable inside it, and a disabled control dispatches no pointer event for a wrapper to hear.
 */
function RefusalHint({
  reason,
  label,
  className,
  children,
}: {
  reason: string | null;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const covered = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);

  // What the current task's writes blurred inside the control. react-aria drops a disabled button's `tabindex`, and a
  // browser blurs the focused element at that write, before any effect can look.
  const blurredThisTask = useRef<EventTarget | null>(null);

  // Native rather than `onBlur`: React holds its own events back while it commits, which is when that blur lands.
  useEffect(() => {
    const control = covered.current;
    if (control === null) return;

    const record = (event: FocusEvent) => {
      blurredThisTask.current = event.target;
      queueMicrotask(() => {
        blurredThisTask.current = null;
      });
    };

    control.addEventListener("focusout", record);
    return () => control.removeEventListener("focusout", record);
  }, []);

  // A reason arriving under the keyboard's focus, as a write closes the control it ran from, hands that focus to the
  // overlay, which holds the same stop under the same name, rather than to the page.
  useLayoutEffect(() => {
    const control = covered.current;
    if (reason === null || control === null) return;

    const blurred = blurredThisTask.current;
    const droppedToPage = document.activeElement === document.body && blurred instanceof Node && control.contains(blurred);
    if (droppedToPage || control.contains(document.activeElement)) overlay.current?.focus();
  }, [reason]);

  // One tree whether a reason stands or not, so a reason arriving or lifting never remounts the control.
  return (
    <div className={`relative inline-block ${className ?? ""}`}>
      {/* `inert`, so assistive technology meets the closed control once, as the overlay naming it: a control merely
          covered is still announced beside it, disabled button or link alike. */}
      <div
        ref={covered}
        inert={reason !== null}>
        {children}
      </div>

      {reason !== null && (
        <RefusalOverlay
          ref={overlay}
          reason={reason}
          label={label}
          covered={covered}
        />
      )}
    </div>
  );
}

/**
 * Mounted with its reason and unmounted with it, so the panel's open state goes too: a reason lifting under an open
 * panel would otherwise leave it open for the next reason to reappear in.
 */
function RefusalOverlay({
  ref,
  reason,
  label,
  covered,
}: {
  ref: RefObject<HTMLDivElement | null>;
  reason: string;
  label: string;
  covered: RefObject<HTMLDivElement | null>;
}) {
  const { isOpen, isDialogOpen, isOpenedByHover, panelKey, onOpenChange, openFromHover, captureDialog } = useHoverOpenOverlay();
  const reasonId = useId();

  return (
    <Popover
      isOpen={isDialogOpen}
      onOpenChange={onOpenChange}>
      {/* The reason is the description, never the name (`label` says why). */}
      <Popover.Trigger
        ref={ref}
        aria-label={label}
        aria-disabled="true"
        aria-describedby={reasonId}
        // `aria-disabled` draws HeroUI's `status-disabled` on `.popover__trigger`, whose `pointer-events: none` would
        // take the hover and the press, and whose opacity would dim the focus outline drawn here. `cursor-auto`:
        // `hintTrigger.ts`.
        className="pointer-events-auto absolute inset-0 cursor-auto opacity-100"
        // The outline follows the corners of the control underneath, which only that control's own classes know.
        onFocus={(event) => {
          const control = covered.current?.firstElementChild;
          if (control) event.currentTarget.style.borderRadius = getComputedStyle(control).borderRadius;
        }}
        onPointerMove={openFromHover}>
        {/* `hidden` and not `sr-only`: `aria-describedby` resolves a hidden element all the same, and a reader walking
            the page then meets the reason once, as the description. */}
        <span
          id={reasonId}
          hidden>
          {reason}
        </span>
      </Popover.Trigger>

      {/* The outer box is cleared: HeroUI's `.popover` draws a fill, a shadow and a larger radius, which would ring
          the panel's own corners. The panel below is the one surface, shared with `IconTooltip`. */}
      <Popover.Content
        key={panelKey}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        placement="top"
        offset={8}
        isNonModal={isOpenedByHover}
        className="bg-transparent shadow-none">
        <HintPanel
          isOpenedByHover={isOpenedByHover}
          panelRef={captureDialog}
          className={`${HINT_SURFACE_CLASSES} leading-normal font-medium text-foreground`}>
          {reason}
        </HintPanel>
      </Popover.Content>
    </Popover>
  );
}
