"use client";

import { useState } from "react";

export default function ExpandableDescription({ text }: { text: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!text) return null;

  if (text.length < 120) {
    return <p className="text-fluid-xs text-foreground mt-2 font-medium text-pretty">{text}</p>;
  }

  return (
    // A pointer convenience layered over a control that is already fully keyboard-accessible: the
    // <button> below toggles both directions, so collapsing by clicking the text adds no capability
    // a keyboard user lacks. Giving this a role would invent a second control for the same action.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="mt-2"
      onClick={() => {
        if (isExpanded) {
          setIsExpanded(false);
        }
      }}>
      <p
        className={`text-fluid-xs text-pretty transition-colors duration-200 ${!isExpanded ? "text-foreground-muted line-clamp-3" : "text-foreground"}`}>
        {text}
      </p>

      <button
        className="text-fluid-xs text-success mt-1.5 cursor-pointer rounded border-none bg-transparent p-0 font-bold transition-opacity hover:opacity-80"
        onClick={() => {
          setIsExpanded(!isExpanded);
        }}>
        {isExpanded ? "Weniger anzeigen" : "Weiterlesen..."}
      </button>
    </div>
  );
}
