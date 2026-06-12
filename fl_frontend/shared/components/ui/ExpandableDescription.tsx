"use client";

import { useState } from "react";

export default function ExpandableDescription({ text }: { text: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!text) return null;

  // Wenn der Text kurz genug ist, rendern wir ihn einfach ganz normal ohne Button
  if (text.length < 120) {
    return <p className="text-fluid-xs text-pretty mt-4">{text}</p>;
  }

  return (
    <div
      className="mt-4"
      onClick={() => {
        if (isExpanded) {
          setIsExpanded(false);
        }
      }}>
      <p
        // line-clamp-3 schneidet nach 3 Zeilen ab und fügt "..." hinzu.
        className={`text-fluid-xs text-pretty transition-all ${!isExpanded ? "line-clamp-4" : ""}`}>
        {text}
      </p>

      {/* HeroUI Link als Button, damit die Styles konsistent bleiben */}
      <button
        className="mt-1 text-fluid-xs font-bold text-emerald-600 hover:text-emerald-500 dark:text-emerald-500 dark:hover:text-emerald-400 transition-colors cursor-pointer bg-transparent border-none p-0"
        onClick={() => setIsExpanded(!isExpanded)}>
        {isExpanded ? "Weniger anzeigen" : "Weiterlesen..."}
      </button>
    </div>
  );
}
