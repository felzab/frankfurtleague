"use client";

import { useEffect, useRef, useState } from "react";

import { previewAdminSpielDataAction } from "../../../actions";

import type { FLPatchSpielDataPayloadDraft } from "@/features/spiele/schemas";

/** The `spiel_nr` of every other fixture a save would rewrite, split by what it would cost them. */
export type VoidPreview = {
  /** Fixtures whose stored result the bracket resolution would clear. */
  voided: readonly number[];
  /** Fixtures a team would be released from, because it is being fielded on their Spieltag. */
  released: readonly number[];
};

/** One request for a two-digit score, settled before a hand reaches Speichern. */
const PREVIEW_DEBOUNCE_MS = 450;

/**
 * **`null` is "no answer", never "nothing would be destroyed"**: the first render, an in-flight
 * request and a failed one all produce it, so a caller rendering reassurance would promise what the
 * preview never said.
 */
export function useVoidPreview({
  previewKey,
  buildPayload,
  isEnabled,
}: {
  /** Stable over the fields that can move an occupant; changing it is what triggers a fetch. */
  previewKey: string;
  buildPayload: () => FLPatchSpielDataPayloadDraft;
  /** False while there is nothing to preview — a group-phase fixture that feeds no bracket slot. */
  isEnabled: boolean;
}): VoidPreview | null {
  /**
   * **Stored with the draft it answers**, which makes the staleness rule enforceable rather than
   * remembered: an answer renders only while its key is current, so an edited draft shows nothing
   * rather than the previous draft's fixtures.
   */
  const [answered, setAnswered] = useState<{ key: string; preview: VoidPreview } | null>(null);

  // Read through a ref, deliberately not a dependency: the form rebuilds `buildPayload` every
  // render, so the debounce would never elapse. `previewKey` decides when to ask again.
  const buildPayloadRef = useRef(buildPayload);
  useEffect(() => {
    buildPayloadRef.current = buildPayload;
  });

  useEffect(() => {
    if (!isEnabled) return;

    // `AbortController` would cancel the fetch but not the server action's round trip, and an
    // answer for a draft that has already changed must not reach the screen.
    let isCurrent = true;

    const timer = setTimeout(async () => {
      const result = await previewAdminSpielDataAction(buildPayloadRef.current());
      if (!isCurrent || !result.success) return;

      setAnswered({ key: previewKey, preview: { voided: result.voidedFixtures ?? [], released: result.releasedFixtures ?? [] } });
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [previewKey, isEnabled]);

  // Derived at render rather than cleared in an effect: both inputs come from the draft already.
  return isEnabled && answered?.key === previewKey ? answered.preview : null;
}
