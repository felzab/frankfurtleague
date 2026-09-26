"use client";

import { useState } from "react";

import { buildEmptyBewerbungDraft } from "@/features/bewerbungen/utils";
import { useUnsavedChangesWarning } from "@/shared/hooks/useUnsavedChangesWarning";

import type { BewerbungFormDraft } from "@/features/bewerbungen/types";
import type { SetStateAction } from "react";

/**
 * The application draft with the one setter that moves it, which arms the unload warning: a setter
 * that did not would let an edit go with an unload in silence, so no other is handed out.
 */
export function useBewerbungDraft(
  saisonId: string,
  isEingereicht: boolean,
): [BewerbungFormDraft, (next: SetStateAction<BewerbungFormDraft>) => void] {
  const [draft, setDraft] = useState<BewerbungFormDraft>(() => buildEmptyBewerbungDraft(saisonId));
  /** Set on the first edit and never cleared: what it guards is the browser's own unload prompt. */
  const [hasTyped, setHasTyped] = useState(false);

  // A long form, entered once, by somebody who will not have it saved anywhere else.
  useUnsavedChangesWarning(hasTyped && !isEingereicht);

  const applyDraft = (next: SetStateAction<BewerbungFormDraft>) => {
    setHasTyped(true);
    setDraft(next);
  };

  return [draft, applyDraft];
}
