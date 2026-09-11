"use client";

import { useState } from "react";

import { BRAND_INK } from "./brandInk";

export function ExpandableDescription({ text }: { text: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!text) return null;

  if (text.length < 120) {
    return <p className="fluid-xs text-foreground font-medium text-pretty">{text}</p>;
  }

  // A pointer convenience: the button below toggles both directions, so this adds no capability a
  // keyboard user lacks and a role would invent a second control for one action.
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="flex flex-col gap-y-1"
      onClick={() => {
        if (isExpanded) {
          setIsExpanded(false);
        }
      }}>
      <p
        className={`fluid-xs text-pretty transition-colors duration-(--motion-base) ${!isExpanded ? "text-foreground-muted line-clamp-3" : "text-foreground"}`}>
        {text}
      </p>

      <button
        className={`${BRAND_INK} fluid-xs cursor-pointer rounded border-none bg-transparent p-0 font-bold`}
        onClick={() => {
          setIsExpanded(!isExpanded);
        }}>
        {isExpanded ? "Weniger anzeigen" : "Weiterlesen..."}
      </button>
    </div>
  );
}
