"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useServerFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { appToast } from "@/shared/utils/appToast";
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
 * Nothing entered yet. `false` counts: an unchecked required box is `valueMissing` to the browser, so a consent
 * switch left off is missing rather than wrong. An empty ARRAY does not — it is a choice somebody made.
 */
function isAbsent(value: unknown): boolean {
  return value === undefined || value === null || value === "" || value === false;
}

/**
 * What one path publishes. **Missing is never a blur's business**: focusing a field and leaving it says nothing,
 * whatever the schema thinks. It becomes sayable only once send has been pressed.
 */
export function verdictMessage(
  found: FieldErrors,
  draft: unknown,
  path: string,
  { afterSubmit = false }: { afterSubmit?: boolean } = {},
): string | null {
  if (isAbsent(valueAtPath(draft, path)) && !afterSubmit) return null;

  return found[path] ?? null;
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
 * The paths a re-judge now accepts, or `null` where none moved. **It only ever retracts**: a path showing nothing is
 * never considered, so no message can appear between two keystrokes (§7), and one still refused is left as it stands.
 */
export function forgivenVerdicts<TSchema extends string>({
  shown,
  payloads,
  schemas,
  submitted,
  afterSubmit,
}: {
  shown: FieldErrors;
  payloads: Readonly<Partial<Record<TSchema, unknown>>>;
  schemas: Readonly<Record<TSchema, ZodType>>;
  submitted: Readonly<Partial<Record<TSchema, unknown>>>;
  /** The same answer `validatePaths` publishes under, or forgiveness retracts what the submit sweep just wrote. */
  afterSubmit: boolean;
}): FieldVerdicts | null {
  const retracted: FieldVerdicts = {};

  for (const path of Object.keys(shown)) {
    // Only the schemas whose payload actually spells this path may speak for it: a two-schema editor would
    // otherwise clear the season half's message on the club half's silence.
    const owners = (Object.keys(payloads) as TSchema[]).filter((schema) => valueAtPath(payloads[schema], path) !== undefined);
    if (owners.length === 0) continue;

    const forgiven = owners.every((schema) => {
      const result = schemas[schema].safeParse(payloads[schema]);
      return verdictMessage(result.success ? {} : toFieldErrors(result.error), payloads[schema], path, { afterSubmit }) === null;
    });
    if (!forgiven) continue;

    // Per path, never per call: a keystroke in one field must leave a server refusal on another standing, and
    // `differs` on that untouched path is what refuses to move it.
    const owner = owners[0]!;
    retracted[path] = { message: null, differs: differsFromSubmitted(submitted[owner], payloads[owner], [path]) };
  }

  return Object.keys(retracted).length === 0 ? null : retracted;
}

/**
 * Every missing value, once send has been pressed. In `aria` validation the browser refuses nothing, so this is the
 * only voice a required field has — and WCAG 3.3.1 wants that error named in text rather than left silent.
 */
export function missingVerdicts<TSchema extends string>({
  payloads,
  schemas,
  submitted,
}: {
  payloads: Readonly<Partial<Record<TSchema, unknown>>>;
  schemas: Readonly<Record<TSchema, ZodType>>;
  submitted: Readonly<Partial<Record<TSchema, unknown>>>;
}): FieldVerdicts | null {
  const published: FieldVerdicts = {};

  for (const schema of Object.keys(payloads) as TSchema[]) {
    const result = schemas[schema].safeParse(payloads[schema]);
    if (result.success) continue;

    for (const [path, message] of Object.entries(toFieldErrors(result.error))) {
      // Missing ONLY. A value that is there and wrong already reaches the field through `validatePaths`, and
      // adding it here would put it back on every field at once — the sea of red this all started with.
      if (!isAbsent(valueAtPath(payloads[schema], path))) continue;

      published[path] = { message, differs: differsFromSubmitted(submitted[schema], payloads[schema], [path]) };
    }
  }

  return Object.keys(published).length === 0 ? null : published;
}

/**
 * Every refusal across the payloads one press writes, keyed as the payload spells it. Separate from the hook so the
 * decision can be exercised without a renderer, and so a two-schema editor's halves merge in one place.
 */
/** Spelled per count rather than interpolated: `1` and the rest need their own German. */
export const BLOCKED_SUBMIT_TITLE = "Noch nicht abgeschickt";

export const blockedSubmitDetail = (refused: number): string =>
  refused === 1
    ? "Ein Feld braucht noch eine Angabe. Es ist unten markiert."
    : `${String(refused)} Felder brauchen noch eine Angabe. Sie sind unten markiert.`;

/**
 * Whether one press may write, and what it must say instead. A UNION, so a caller cannot read the answer without
 * naming its case, and the boundary — one refusal already blocks — is a property a test can exercise.
 */
export type SubmitDecision = { blocked: true; refusals: FieldErrors } | { blocked: false };

export function submitDecision<TSchema extends string>(args: {
  payloads: Readonly<Partial<Record<TSchema, unknown>>>;
  schemas: Readonly<Record<TSchema, ZodType>>;
}): SubmitDecision {
  const refusals = submitRefusals(args);

  return Object.keys(refusals).length === 0 ? { blocked: false } : { blocked: true, refusals };
}

export function submitRefusals<TSchema extends string>({
  payloads,
  schemas,
}: {
  payloads: Readonly<Partial<Record<TSchema, unknown>>>;
  schemas: Readonly<Record<TSchema, ZodType>>;
}): FieldErrors {
  const refusals: FieldErrors = {};

  for (const schema of Object.keys(payloads) as TSchema[]) {
    const result = schemas[schema].safeParse(payloads[schema]);
    if (!result.success) Object.assign(refusals, toFieldErrors(result.error));
  }

  return refusals;
}

/**
 * `current` ITSELF wherever nothing moved. These verdicts are recomputed after every render, so a fresh object for
 * an unchanged one would re-render forever. Never simplify to an unconditional spread.
 */
export function applyVerdicts(current: FieldVerdicts, incoming: FieldVerdicts | null): FieldVerdicts {
  if (incoming === null) return current;

  const moved = Object.entries(incoming).some(
    ([path, verdict]) => current[path]?.message !== verdict.message || current[path]?.differs !== verdict.differs,
  );

  return moved ? { ...current, ...incoming } : current;
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
   * Whether send has been pressed. Missing-value messages wait for it, so tabbing an untouched form paints nothing.
   * Listened for rather than threaded through each editor: `runOnSubmit` prevents the default, but the event fired.
   */
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  useEffect(() => {
    const form = formRef.current;
    if (form === null) return;

    const onSubmit = () => {
      setHasAttemptedSubmit(true);
    };

    form.addEventListener("submit", onSubmit);
    return () => {
      form.removeEventListener("submit", onSubmit);
    };
  }, [formRef]);

  /**
   * What each schema's last submit was answering about. A ref because a blur can land in the same tick as the submit
   * that wrote it — `reportValidity()` moves focus, blurring whichever field the admin was in.
   */
  const submittedPayloads = useRef<Partial<Record<TSchema, unknown>>>({});

  /**
   * **Every verdict recorded before this goes**: a submit parses the whole draft, so its map is complete. Never write a
   * blur-time judgement here — this map is what moves focus.
   */
  const setSubmitFieldErrors = useCallback(
    (errors: FieldErrors, judged: Readonly<Partial<Record<TSchema, unknown>>>) => {
      submittedPayloads.current = { ...judged };
      setHasAttemptedSubmit(true);
      setVerdicts({});
      setFieldErrors(errors);
    },
    // Stable, so a caller reading a server result from an effect can depend on it without re-running
    // that effect — and re-moving focus — on every render. It closes over setters and a ref alone.
    [setFieldErrors],
  );

  /**
   * **A typed control is validated when it is left; a picked one on change** — a message between two keystrokes
   * describes a value nobody finished entering. An absent path publishes `null`, leaving emptiness to the browser.
   */
  const validatePaths = (schema: TSchema, draft: unknown, paths: readonly string[]) => {
    const result = schemas[schema].safeParse(draft);
    const found = result.success ? {} : toFieldErrors(result.error);
    const differs = differsFromSubmitted(submittedPayloads.current[schema], draft, paths);

    setVerdicts((current) => {
      const next = { ...current };
      for (const path of paths) {
        next[path] = { message: verdictMessage(found, draft, path, { afterSubmit: hasAttemptedSubmit }), differs };
      }
      return next;
    });
  };

  /**
   * **Forgiveness, and only forgiveness.** Retracts the messages the schema now accepts, so a corrected field clears
   * without a blur. It can never ADD one: §7 forbids judging a typed field between two keystrokes.
   */
  const useForgiveFixed = (payloads: Readonly<Partial<Record<TSchema, unknown>>>) => {
    const shown = mergeFieldVerdicts(submitErrors, verdicts);

    useEffect(() => {
      setVerdicts((current) => {
        const submitted = submittedPayloads.current;
        const afterSubmit = hasAttemptedSubmit;
        const forgiven = applyVerdicts(current, forgivenVerdicts({ shown, payloads, schemas, submitted, afterSubmit }));
        if (!afterSubmit) return forgiven;

        return applyVerdicts(forgiven, missingVerdicts({ payloads, schemas, submitted }));
      });
    });
  };

  /**
   * **The submit's only gate.** `aria` stops nothing natively, so a form without this call posts what it holds.
   * It RUNS the write rather than answering: a returned answer can be dropped at a call site, and there are twelve.
   */
  const guardSubmit = (payloads: Readonly<Partial<Record<TSchema, unknown>>>, write: () => void): void => {
    const decision = submitDecision({ payloads, schemas });

    if (decision.blocked) {
      setSubmitFieldErrors(decision.refusals, payloads);
      // Announced as well as marked. A `FieldError` is a plain span in no live region, so a blocked press
      // reaches a screen reader as a button that did nothing; every toast carries `role="alert"`.
      appToast.danger(BLOCKED_SUBMIT_TITLE, { description: blockedSubmitDetail(Object.keys(decision.refusals).length) });
      return;
    }

    // Nothing to say, but the attempt still happened: a later blur must not fall back to staying quiet
    // about an emptied field.
    setHasAttemptedSubmit(true);
    write();
  };

  return {
    /**
     * Never either store on its own, and deliberately not memoised: react-aria latches "this server error was cleared"
     * per `FormValidationContext` identity, so a stable object hands that decision back to the library.
     */
    fieldErrors: mergeFieldVerdicts(submitErrors, verdicts),
    setSubmitFieldErrors,
    guardSubmit,
    validatePaths,
    useForgiveFixed,
    formRef,
  };
}
