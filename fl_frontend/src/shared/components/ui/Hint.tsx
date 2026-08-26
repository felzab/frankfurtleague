"use client";

import { CircleInfo } from "@gravity-ui/icons";

import { Popover } from "@heroui/react";

import { useHoverOpenOverlay } from "@/shared/hooks/useHoverOpenOverlay";

import { HINT_SURFACE } from "./hintSurface";
import { overlayPanel } from "./overlayPanel";

import type { ReactNode } from "react";

/**
 * The bold run is a field rather than markup inside `text`, so `hintCap.test.ts` can count what a
 * hint says. A `ReactNode` bullet is unmeasurable, and an uncounted hint grows without a bound.
 */
type HintPoint = { term?: string; text: string };

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

type HintPlacement = "top" | "right" | "bottom" | "left";

type HintProps =
  /** Rendered in the flow, so mounting one on a keystroke shifts the layout under somebody typing. */
  | {
      mode: "inline";
      text: string;
      /**
       * The `id` this paragraph publishes, carried by the control it explains in `aria-describedby`.
       * Required so no hint lands describing nothing, and `hintCap.test.ts` looks for the other end.
       */
      describes: string;
    }
  /**
   * For a hint that owns its own press. A control that owns one keeps `IconTooltip`, whose panel a
   * modal popover would steal the press of.
   */
  | { mode: "reveal"; label: string; body: HintBody; trigger?: ReactNode }
  /**
   * A refusal is not capped here: `adminMutation.ts :: VALIDATION_FAILED` sets its register, which
   * allows the second sentence that names the way out.
   */
  | { mode: "refusal"; reason: string | null; className?: string; placement?: HintPlacement; children: ReactNode };

/**
 * **No severity, deliberately.** A hint written where a blocking banner was owed would never reach
 * the save gate, `resolveBlockingBanners` dropping `info` so it cannot raise the dialog. Grade a
 * consequence in the editor's `banners.ts` instead.
 */
export function Hint(props: HintProps) {
  if (props.mode === "inline")
    return (
      // The scale is spelled out and not `muted-hint`, which is `fluid-sm`: this paragraph sits under a control and
      // pairs with the same sentence on a mirrored panel, where two type steps apart read as two designs.
      <p
        id={props.describes}
        className="fluid-xxs text-foreground-muted leading-normal font-medium">
        {props.text}
      </p>
    );

  if (props.mode === "refusal")
    return (
      <RefusalHint
        reason={props.reason}
        className={props.className}
        placement={props.placement}>
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

/**
 * **A popover rather than a tooltip because of touch**: react-aria's tooltip never opens on a tap, so
 * on a phone it is unreachable, and `useHoverOpenOverlay` adds the hover half back.
 */
function RevealHint({ label, body, trigger }: { label: string; body: HintBody; trigger?: ReactNode }) {
  const { isOpen, onOpenChange, openFromHover, captureDialog } = useHoverOpenOverlay();

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={onOpenChange}>
      {/* An inline glyph rather than a flex sibling: a text run's visual mass sits above its line box's centre, so
          centring in a row cannot look right. `align-middle` aligns any icon size with no tuned constant. */}
      <Popover.Trigger
        aria-label={label}
        className={
          trigger
            ? "hover:bg-hover -m-0.5 inline-flex shrink-0 cursor-help items-center justify-center rounded-md p-0.5 align-middle transition-colors"
            : "text-foreground-muted hover:text-brand ms-1.5 inline-flex shrink-0 cursor-help align-middle transition-colors [--hint-icon-size:1em]"
        }
        onMouseEnter={openFromHover}>
        {trigger ?? <CircleInfo className="h-(--hint-icon-size) w-(--hint-icon-size) cursor-help" />}
      </Popover.Trigger>

      <Popover.Content
        placement="top"
        offset={8}>
        <Popover.Dialog
          ref={captureDialog}
          className={`${overlayPanel()} fluid-xs text-foreground flex w-max max-w-88 flex-col gap-y-2 p-4 leading-normal font-medium outline-none`}>
          <p>{body.lead}</p>
          {body.points !== undefined && body.points.length > 0 && (
            <ul className="flex flex-col gap-y-1.5">
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
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

/**
 * **On a wrapper, never on the control.** A disabled control dispatches no pointer event and none
 * reaches an ancestor, so the wrapper is the hit target — and the tab stop, a disabled button being
 * out of the tab order entirely.
 */
function RefusalHint({
  reason,
  className,
  placement = "top",
  children,
}: {
  reason: string | null;
  className?: string;
  placement?: HintPlacement;
  children: ReactNode;
}) {
  const { isOpen, onOpenChange, openFromHover, captureDialog } = useHoverOpenOverlay();

  // `inline-block` is what `.popover__trigger` resolves to, so a flex parent lays both branches out identically.
  if (reason === null) return <div className={`inline-block ${className ?? ""}`}>{children}</div>;

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={onOpenChange}>
      {/* `cursor-help`, as the reveal trigger uses for the same promise. It reaches the pointer because the control does not. */}
      <Popover.Trigger
        aria-label={reason}
        className={`cursor-help ${className ?? ""}`}
        onMouseEnter={openFromHover}>
        {children}
      </Popover.Trigger>

      {/* The outer box is cleared: HeroUI's `.popover` draws a fill, a shadow and a larger radius, which would ring
          the panel's own corners. The panel below is the one surface, shared with `IconTooltip`. */}
      <Popover.Content
        placement={placement}
        offset={8}
        className="bg-transparent shadow-none">
        <Popover.Dialog
          ref={captureDialog}
          className={`${HINT_SURFACE} text-foreground leading-normal font-medium`}>
          {reason}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
