"use client";

import { COPY } from "@/core/copy";

import { Button } from "./Button";

import type { Copy } from "@/core/copy";

/**
 * One line adopting what somebody else proposed, such as the referee's result in the match editor's Ergebnis
 * section (D295): the proposal in words, „Laut Spielbericht 3:1“, and „Übernehmen“ at the line's end, which fills
 * the fields from it, the save still the editor's own. On a line too narrow for both the button moves under the
 * words.
 */
export function AdoptLine({ text, onAdopt }: { text: Copy; onAdopt: () => void }) {
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-3 text-sm">
      <span>{text}</span>
      <Button
        variant="secondary"
        label={COPY.shared.verb.adopt}
        onPress={onAdopt}
      />
    </div>
  );
}
