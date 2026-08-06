"use client";

/**
 * SHARED · client-side field validation from the payload schema
 *
 * The other half of `useServerFieldErrors`. That hook holds the messages a server action returned; this
 * one produces the same messages in the browser, from the **same schema the action parses**, so the two
 * cannot state different rules about the same field (ADR-0050).
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • The draft is parsed WHOLE and only the named paths are published. A field the user has not reached
 *     yet must not be marked invalid, and a schema cannot be asked about one field in isolation — a
 *     cross-field refinement has no single owner.
 *   • A verdict is `null` when the value satisfies the schema — recorded, not forgotten. That is what
 *     retracts the server's older complaint about the same field without writing to the server's own
 *     state, which is the part that must not be touched: `useServerFieldErrors` moves focus whenever its
 *     map changes, and it is right to, because a message that arrives from a submit should be found.
 *   • This hook never moves focus and never calls `reportValidity()`. Focus belongs to submit, where the
 *     user asked for the whole form to be judged; stealing it mid-form is the failure mode that makes
 *     eager validation worse than none.
 */
import { useCallback, useState } from "react";

import { toFieldErrors } from "@/shared/utils/validation";

import type { FieldErrors } from "@/shared/utils/validation";
import type { ZodType } from "zod";

/** What the browser has decided about a field: a message, or `null` for "this one is fine now". */
type Verdicts = Record<string, string | null>;

/**
 * Per-field verdicts on a draft payload, refreshed one control at a time.
 *
 * **When a caller fires this decides whether eager validation helps or hurts, so the rule is stated
 * here rather than left to each form.** A control the user *types* into is validated when it is
 * **left** — a message raised between two keystrokes describes a value nobody has finished entering,
 * and on a narrow screen it also moves the submit button while a thumb is travelling towards it. A
 * control the user *picks* from — an autocomplete, a switch — is validated **on change**, because a
 * selection is complete the moment it is made and there is no half-typed state to be wrong about.
 *
 * `paths` is a list rather than one key because a cross-field rule reports where the schema puts it, not
 * where the user was: a shoot-out that ends level is reported on the second count whichever count was
 * edited, so both paths are refreshed together or the message never clears.
 */
export function useDraftValidation(schema: ZodType) {
  const [verdicts, setVerdicts] = useState<Verdicts>({});

  const validatePaths = useCallback(
    (draft: unknown, paths: readonly string[]) => {
      const result = schema.safeParse(draft);
      const found = result.success ? {} : toFieldErrors(result.error);

      setVerdicts((current) => {
        const next = { ...current };
        for (const path of paths) next[path] = found[path] ?? null;
        return next;
      });
    },
    [schema],
  );

  /** Drops every verdict, for a submit that succeeded. */
  const clearVerdicts = useCallback(() => setVerdicts({}), []);

  /**
   * The server's messages with this hook's newer verdicts laid over them.
   *
   * The browser's answer wins in both directions: it adds a message the server has not seen yet, and it
   * removes one the server raised about a value that has since been corrected.
   */
  const mergedWith = (serverErrors: FieldErrors): FieldErrors => {
    const merged: FieldErrors = { ...serverErrors };

    for (const [path, message] of Object.entries(verdicts)) {
      if (message === null) delete merged[path];
      else merged[path] = message;
    }
    return merged;
  };

  return { validatePaths, clearVerdicts, mergedWith };
}
