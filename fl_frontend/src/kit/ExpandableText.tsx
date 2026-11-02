"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "react-aria-components/Button";
import { usePress } from "react-aria/usePress";

import { COPY } from "@/core/copy";

import { tv } from "./tv";

const text = tv({
  slots: {
    root: "relative text-sm",
    // Three lines and no more while folded, cut without „…“: „Mehr“ stands over the third line's end.
    body: "whitespace-pre-line",
    more: "cursor-pointer text-brand underline",
  },
  variants: {
    open: {
      false: {
        body: "max-h-[3lh] overflow-hidden",
        // On the card's own fill, a short fade before it, so the line runs into the word rather than under it.
        more: "absolute end-0 bottom-0 bg-bg-card ps-1 before:absolute before:inset-y-0 before:end-full before:w-6 before:bg-linear-to-r before:from-transparent before:to-bg-card",
      },
      true: { body: "cursor-pointer", more: "ms-1" },
    },
  },
});

/**
 * A record's own long text on a card, such as a club's description: three lines, and „Mehr“ in the brand colour,
 * underlined, at the end of the third line, where the text runs on. A press on „Mehr“ opens the rest; once open, a
 * press anywhere on the text folds it again, and „Mehr“, which keeps its `aria-expanded`, does so from the keyboard.
 * Whether the text runs past three lines is measured in the browser, so a short text shows no „Mehr“; before the
 * page hydrates the text stands folded without it.
 */
export function ExpandableText({ children }: { children: string }) {
  const [isOpen, setOpen] = useState(false);
  const [runsOn, setRunsOn] = useState(false);
  const body = useRef<HTMLParagraphElement>(null);
  // A pointer's convenience beside the button, which is the one control a keyboard and a reader reach.
  const { pressProps } = usePress({ isDisabled: !isOpen, onPress: () => setOpen(false) });

  useEffect(() => {
    const element = body.current;
    if (element === null || isOpen) return;
    const measure = () => setRunsOn(element.scrollHeight > element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [isOpen]);

  const slots = text({ open: isOpen });
  return (
    <div className={slots.root()}>
      <p
        ref={body}
        className={slots.body()}
        {...pressProps}>
        {children}
        {(runsOn || isOpen) && (
          <Button
            aria-expanded={isOpen}
            data-kit-focus="text"
            className={slots.more()}
            onPress={() => setOpen(!isOpen)}>
            {COPY.template.more}
          </Button>
        )}
      </p>
    </div>
  );
}
