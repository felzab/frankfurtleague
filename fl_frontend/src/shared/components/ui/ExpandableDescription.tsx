"use client";

import { useState } from "react";

export default function ExpandableDescription({ text }: { text: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!text) return null;

  if (text.length < 120) {
    return <p className="text-fluid-xs text-foreground mt-2 font-medium text-pretty">{text}</p>;
  }

  return (
    <div
      className="mt-2"
      onClick={() => {
        if (isExpanded) {
          setIsExpanded(false);
        }
      }}>
      <p className={`text-fluid-xs text-pretty transition-all ${!isExpanded ? "text-foreground-muted line-clamp-3" : "text-foreground"}`}>
        {text}
      </p>

      <button
        className="text-fluid-xs text-success focus-visible:ring-brand mt-1.5 cursor-pointer rounded border-none bg-transparent p-0 font-bold transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:outline-none"
        onClick={() => {
          setIsExpanded(!isExpanded);
        }}>
        {isExpanded ? "Weniger anzeigen" : "Weiterlesen..."}
      </button>
    </div>
  );
}
