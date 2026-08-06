"use client";

/**
 * SPIELE · what saving this draft would destroy, asked live
 *
 * Debounced `dry_run=true` against the write path, which applies the payload in memory and resolves
 * the bracket without writing (ADR-0051). What comes back is the save's own answer, so the warning
 * this drives names exactly the fixtures a save would take a stored result from — not the fixtures
 * that merely *could* lose one.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Keyed on the BRACKET-relevant fields alone. A venue or a kick-off time cannot move an occupant,
 *     so refetching on one would be a request per keystroke answering a question that has not changed.
 *   • A stale response is DISCARDED, never rendered. Requests are debounced but not serialised, so a
 *     slow early answer can arrive after a fast later one and would otherwise overwrite it — the
 *     warning would then name fixtures for a draft the admin has moved on from.
 *   • A failed preview clears the warning rather than showing a stale or an alarming one. The preview
 *     is an extra; an admin must never be blocked from saving because it could not be computed.
 */
import { useEffect, useRef, useState } from "react";

import { previewAdminSpielDataAction } from "../../../actions";

import type { FLPatchSpielDataPayload } from "@/features/spiele/schemas";

/** The `spiel_nr` of every other fixture a save would rewrite, split by what it would cost them. */
export type VoidPreview = {
  /** Fixtures whose stored result the bracket resolution would clear (ADR-0051). */
  voided: readonly number[];
  /** Fixtures a team would be released from, because it is being fielded on their Spieltag (ADR-0052). */
  released: readonly number[];
};

/**
 * Long enough that typing a two-digit score is one request rather than two, short enough that the
 * warning has settled before a hand reaches Speichern. The request is read-only, so the cost of being
 * wrong in either direction is small — which is why this is a constant and not a setting.
 */
const PREVIEW_DEBOUNCE_MS = 450;

/**
 * What saving `payload` would move and destroy, or `null` while that is unknown.
 *
 * `null` is "no answer", never "nothing would be destroyed" — the first render, an in-flight request
 * and a failed one all produce it, and a caller that rendered "nichts geht verloren" for `null` would
 * make a promise the preview never made.
 *
 * `buildPayload` is read through a ref and deliberately not a dependency: the form rebuilds it on
 * every render, so depending on it would fire a request per keystroke and the debounce would never
 * elapse. `previewKey` is what decides when to ask again.
 */
export function useVoidPreview({
  previewKey,
  buildPayload,
  isEnabled,
}: {
  /** A stable string over the fields that can move an occupant. Changing it is what triggers a fetch. */
  previewKey: string;
  buildPayload: () => FLPatchSpielDataPayload;
  /** False while there is nothing to preview — a group-phase fixture that feeds no bracket slot. */
  isEnabled: boolean;
}): VoidPreview | null {
  /**
   * The answer, **stored with the draft it answers**.
   *
   * That pairing is what makes the staleness rule enforceable rather than remembered: an answer is
   * rendered only while the key it was computed for is still the current one, so a draft the admin has
   * edited since shows nothing at all rather than the previous draft's fixtures. For a warning about
   * destroying data, "no answer yet" is the only honest thing to say in that gap.
   */
  const [answered, setAnswered] = useState<{ key: string; preview: VoidPreview } | null>(null);

  const buildPayloadRef = useRef(buildPayload);
  useEffect(() => {
    buildPayloadRef.current = buildPayload;
  });

  useEffect(() => {
    if (!isEnabled) return;

    // Flipped by the cleanup, and checked after the await. `AbortController` would cancel the fetch
    // but not the server action's own round trip, and this is the part that matters: whatever comes
    // back for a draft that has already changed must not reach the screen.
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

  // Derived at render rather than cleared in an effect: `isEnabled` and `previewKey` are both computed
  // from the draft, so a state write here would be React re-deriving what it already knows — and the
  // cascading render it costs is what `react-hooks/set-state-in-effect` exists to catch.
  return isEnabled && answered?.key === previewKey ? answered.preview : null;
}
