"use client";

import { COPY } from "@/core/copy/shared";

import { Button } from "./Button";

import type { Copy } from "@/core/copy";

/**
 * One line adopting what somebody else proposed: „Übernehmen“ fills the fields from it, the save still the editor's
 * own, so the person checks the proposal before it is stored.
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
