"use client";

/**
 * SHARED · the one field-error map an editor form renders
 *
 * Composes the two halves of a draft form's validation — the messages a submit produced and the
 * verdicts the browser reaches from the payload schema — so the merge happens in here and
 * no form can wire its order wrong. A submit judges the whole draft and therefore supersedes every
 * verdict before it; a verdict recorded afterwards speaks about a path the submit named only where
 * it judged a different value than the submit did.
 *
 * Invariants:
 * - The two stores stay separate; only the derived map is merged, so no verdict writes into the
 *   submit's map.
 * - A verdict rewrites a path the submit also named only where the value beneath it has moved.
 * - `reportValidity()` runs from an effect and only on a new submit map — never on a blur.
 *
 * See:
 * - docs/frontend/spec.md — invariants I18 and I19
 */
import { useRef, useState } from "react";

import { useServerFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { toFieldErrors } from "@/shared/utils/validation";

import type { FieldErrors } from "@/shared/utils/validation";
import type { ZodType } from "zod";

/**
 * What the browser has decided about one field, and whether that decision is about a moved value.
 *
 * `null` is "this one is fine now". `differs` is what makes the verdict's authority a fact rather
 * than a guess: it records that the draft judged here holds something other than what the last
 * submit was answering about, which is the only ground on which a browser verdict may speak over a
 * server's refusal.
 */
export type FieldVerdict = { message: string | null; differs: boolean };

/** Every path this form's browser-side validation has judged, keyed as the payload spells it. */
export type FieldVerdicts = Record<string, FieldVerdict>;

/** One dotted payload path resolved against an object, `undefined` wherever the chain runs out. */
function valueAtPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (typeof value !== "object" || value === null) return undefined;
    return (value as Record<string, unknown>)[key];
  }, source);
}

/**
 * Whether the draft about to be judged holds a different value from the submitted payload.
 *
 * **Per CALL rather than per path, and that is the load-bearing half.** `validatePaths` takes a list
 * because a cross-field rule reports where the schema puts it rather than where the user was: the
 * level-shoot-out refine reports on `elfmeterschiessen.team2` whichever count was edited, so editing
 * `team1` has to unlock the `team2` verdict or the message never clears.
 *
 * `JSON.stringify` rather than a deep walk, matching what
 * `fl_frontend/src/features/spiele/components/forms/AdminEditSpielDataForm/AdminEditSpielDataForm.tsx :: previewKey`
 * already compares these payloads with. A path with no submit behind it differs by definition:
 * nothing has been said about it that a verdict could be superseded by.
 */
export function differsFromSubmitted(submitted: unknown, draft: unknown, paths: readonly string[]): boolean {
  if (submitted === undefined) return true;

  return paths.some((path) => JSON.stringify(valueAtPath(draft, path)) !== JSON.stringify(valueAtPath(submitted, path)));
}

/**
 * The map a form renders: the submit's messages, with the verdicts that judged a MOVED value over them.
 *
 * **A verdict says only that the payload schema is happy with a value.** Matchday spans,
 * disqualifications, season membership and Spieltag occupancy are rules the server alone holds, so a
 * verdict on an untouched value knows nothing the submit did not already decide about it. Recency
 * cannot separate the two cases: every blur-validated control judges its path whether or not anybody
 * changed it, and `reportValidity()` moves focus INTO the refused field — so the admin's next Tab
 * records a `null` newer than the refusal about the very value it refused. Graded by age alone, that
 * deletes the message from every surface at once, because `deriveSpielDraftStatus` reads this map.
 *
 * A path the submit did not name is not a disagreement: nothing is being rewritten, so the browser's
 * own message stands, `null` retracting it and a message replacing it.
 */
export function mergeFieldVerdicts(submitErrors: FieldErrors, verdicts: FieldVerdicts): FieldErrors {
  const merged: FieldErrors = { ...submitErrors };

  for (const [path, verdict] of Object.entries(verdicts)) {
    if (path in submitErrors && !verdict.differs) continue;

    if (verdict.message === null) delete merged[path];
    else merged[path] = verdict.message;
  }

  return merged;
}

/**
 * The field errors an editor form renders, its form ref, and the two ways to write into them.
 *
 * `schemas` is a record rather than one schema because two editors validate two payloads with two
 * schemas — the person and the season membership, the club and the season membership — and the pair is
 * this hook's first-class case rather than a chain of merges assembled at the call site. The key names
 * the payload; `validatePaths` takes it, so which schema judged a field is readable at the call.
 *
 * The schema each key holds is the one the matching server action parses, which is what stops the
 * browser and the server stating different rules (`docs/frontend/spec.md` I18).
 */
export function useDraftFieldErrors<TSchema extends string>({
  schemas,
  onUnhandledErrors,
}: {
  schemas: Readonly<Record<TSchema, ZodType>>;
  /**
   * Fires when a submit was refused on a path no rendered input can display — the caller's cue to say
   * so in a toast, because nothing on screen will.
   */
  onUnhandledErrors?: (errors: FieldErrors) => void;
}) {
  const { fieldErrors: submitErrors, setFieldErrors, formRef } = useServerFieldErrors(onUnhandledErrors);

  const [verdicts, setVerdicts] = useState<FieldVerdicts>({});

  /**
   * What each schema's last submit was answering about, which is what a later verdict is graded against.
   *
   * A ref rather than state, because a blur can land in the same tick as the submit that wrote this:
   * `reportValidity()` moves focus to the first refused field, and that blurs whichever field the admin
   * was in. Nothing renders from it, so there is no re-render to buy.
   */
  const submittedPayloads = useRef<Partial<Record<TSchema, unknown>>>({});

  /**
   * Records what a submit was refused on — the server's answer, or the narrowing that refused to send —
   * together with the payloads it was answering about.
   *
   * **Every verdict recorded before this goes, and that is the rule rather than housekeeping.** A submit
   * parses the whole draft with the same schema the browser reaches, so its map is complete for that
   * draft: any verdict older than it either agrees with it or describes a value the submit has since
   * judged. Kept, a stale one stands on a field showing the corrected value and counts toward the
   * unsaved-error badge.
   *
   * Distinct from a verdict rather than a synonym for one: this map is what moves focus, so writing a
   * blur-time judgement here would throw focus onto the next unfixed field while somebody was tabbing
   * past it (`docs/frontend/spec.md` I19).
   */
  const setSubmitFieldErrors = (errors: FieldErrors, judged: Readonly<Partial<Record<TSchema, unknown>>>) => {
    submittedPayloads.current = { ...judged };
    setVerdicts({});
    setFieldErrors(errors);
  };

  /**
   * Judges `draft` against one of the declared schemas and publishes the answer for `paths`.
   *
   * **When a caller fires this decides whether eager validation helps or hurts, so the rule is stated
   * here rather than left to each form.** A control the user *types* into is validated when it is
   * **left** — a message raised between two keystrokes describes a value nobody has finished entering,
   * and on a narrow screen it also moves the submit button while a thumb is travelling towards it. A
   * control the user *picks* from — an autocomplete, a switch — is validated **on change**, because a
   * selection is complete the moment it is made and there is no half-typed state to be wrong about.
   *
   * The draft parses WHOLE and only `paths` publish, because a cross-field refinement has no single
   * owner: a shoot-out that ends level is reported on the second count whichever count was edited, so
   * both paths are refreshed together or the message never clears. `differsFromSubmitted` reads the
   * same list for the same reason.
   */
  const validatePaths = (schema: TSchema, draft: unknown, paths: readonly string[]) => {
    const result = schemas[schema].safeParse(draft);
    const found = result.success ? {} : toFieldErrors(result.error);
    const differs = differsFromSubmitted(submittedPayloads.current[schema], draft, paths);

    setVerdicts((current) => {
      const next = { ...current };
      for (const path of paths) next[path] = { message: found[path] ?? null, differs };
      return next;
    });
  };

  return {
    /**
     * The merged map, ready for `<Form validationErrors>` — never either store on its own.
     *
     * Deliberately NOT memoised. react-aria latches "this server error was cleared" per
     * `FormValidationContext` identity, so a stable object would hand the decision to clear a message
     * back to the library and reinstate a variant of the bug this merge exists to fix.
     */
    fieldErrors: mergeFieldVerdicts(submitErrors, verdicts),
    setSubmitFieldErrors,
    validatePaths,
    formRef,
  };
}
