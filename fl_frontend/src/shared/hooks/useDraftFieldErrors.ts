"use client";

import { useRef, useState } from "react";

import { useServerFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { toFieldErrors } from "@/shared/utils/validation";

import type { FieldErrors } from "@/shared/utils/validation";
import type { ZodType } from "zod";

/**
 * `null` is "this one is fine now". `differs` records that the draft holds something other than what the last submit was
 * answering about, which is the only ground on which a browser verdict may speak over a server's refusal.
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
 * **Per call rather than per path.** A cross-field rule reports where the schema puts it rather than where the user
 * was, so editing one side has to unlock the other side's verdict or the message never clears.
 */
export function differsFromSubmitted(submitted: unknown, draft: unknown, paths: readonly string[]): boolean {
  if (submitted === undefined) return true;

  return paths.some((path) => JSON.stringify(valueAtPath(draft, path)) !== JSON.stringify(valueAtPath(submitted, path)));
}

/**
 * The submit's messages, with the verdicts that judged a **moved** value over them: a verdict says only that the schema
 * is happy, and recency cannot stand in, `reportValidity()` moving focus into the very field it refused.
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
 * The one field-error map an editor renders, so no form wires the merge's order wrong
 * (`docs/frontend/spec.md` I19). Each key's schema is the one its server action parses
 * (`docs/frontend/spec.md` I18), or browser and server state different rules.
 */
export function useDraftFieldErrors<TSchema extends string>({ schemas }: { schemas: Readonly<Record<TSchema, ZodType>> }) {
  const { fieldErrors: submitErrors, setFieldErrors, formRef } = useServerFieldErrors();

  const [verdicts, setVerdicts] = useState<FieldVerdicts>({});

  /**
   * What each schema's last submit was answering about. A ref because a blur can land in the same tick as the submit
   * that wrote it — `reportValidity()` moves focus, blurring whichever field the admin was in.
   */
  const submittedPayloads = useRef<Partial<Record<TSchema, unknown>>>({});

  /**
   * **Every verdict recorded before this goes**: a submit parses the whole draft, so its map is complete. Never write a
   * blur-time judgement here — this map is what moves focus.
   */
  const setSubmitFieldErrors = (errors: FieldErrors, judged: Readonly<Partial<Record<TSchema, unknown>>>) => {
    submittedPayloads.current = { ...judged };
    setVerdicts({});
    setFieldErrors(errors);
  };

  /**
   * **A typed control is validated when it is left; a picked one on change** — a message between two keystrokes
   * describes a value nobody finished entering. The draft parses whole and only `paths` publish.
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
     * Never either store on its own, and deliberately not memoised: react-aria latches "this server error was cleared"
     * per `FormValidationContext` identity, so a stable object hands that decision back to the library.
     */
    fieldErrors: mergeFieldVerdicts(submitErrors, verdicts),
    setSubmitFieldErrors,
    validatePaths,
    formRef,
  };
}
