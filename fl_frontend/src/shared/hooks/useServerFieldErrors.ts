"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { appToast } from "@/shared/utils/appToast";
import { UNHANDLED_FIELD_REFUSAL, UNSHOWN_COST } from "@/shared/utils/refusal";

import type { ActionFailure } from "@/shared/types/types";
import type { FieldErrors } from "@/shared/utils/validation";

/** Refused paths' own messages as one run of sentences, or `""` where none brings one. */
export function joinedMessages(messages: readonly string[]): string {
  // Once each: one message refusing several paths reads as one reason.
  const reasons = [...new Set(messages.map((message) => message.trim()).filter((message) => message !== ""))];

  // A message closes itself where it lacks a full stop, so the next one never runs on from it.
  return reasons.map((reason) => (/[.!?]$/.test(reason) ? reason : `${reason}.`)).join(" ");
}

/**
 * The fallback for refused paths no control shows: what the save cost, then each path's own message, which is the
 * one thing that tells the reader what to change. A retry is offered only where no path brought a message.
 */
export function unshownRefusal(messages: readonly string[]): string {
  const reasons = joinedMessages(messages);

  return reasons === "" ? UNHANDLED_FIELD_REFUSAL : `${UNSHOWN_COST}. ${reasons}`;
}

/** The admin editors' word for a failed save; a form whose save is not a change passes its own title. */
const DEFAULT_FAILURE_TITLE = "Änderung nicht gespeichert";

/** A press's failure toast, handed the sentence the render chose, so the site's own title stays readable at its raise. */
export type RaiseFailure = (shown: ActionFailure) => void;

export type FailureAnnouncement = {
  /** Where the site's title is not the form's `failureTitle`. */
  raise?: RaiseFailure;
  /** A failure saying more than the marked controls, such as the half of a two-part press that saved. */
  evenWhenShown?: boolean;
};

type OwedToast = { failure: ActionFailure; raise: RaiseFailure; evenWhenShown: boolean };

/** Focus order inside a react-aria field root, once the named element has refused focus itself. */
const FOCUSABLE = "input:not([type=hidden]), select, textarea, button:not([tabindex='-1']), [tabindex='0']";

/** The wrapper react-aria puts round one field's parts. */
const FIELD_ROOT = "[data-rac][data-slot]";

/**
 * The subtrees react-aria keeps out of the accessibility tree — the mirror it submits a `Select`'s value from is
 * one. Focus lands there happily and a screen reader announces nothing, so a caret parked in one is lost.
 */
const HIDDEN_FROM_AT = '[aria-hidden="true"], [data-react-aria-prevent-focus]';

/** Whether focus on this element would be announced, and whether it actually landed. */
function takeFocus(candidate: HTMLElement): boolean {
  if (candidate.closest(HIDDEN_FROM_AT) !== null) return false;

  candidate.focus();
  return candidate.ownerDocument.activeElement === candidate;
}

/**
 * The field a named control belongs to. `closest` is asked of the PARENT because a control can carry the root's
 * own attributes. A `NumberField` needs the sibling arm: its named input sits next to the root, not inside it.
 */
function fieldRootOf(control: Element): Element | null {
  const enclosing = control.parentElement?.closest(FIELD_ROOT) ?? null;
  if (enclosing !== null) return enclosing;

  const previous = control.previousElementSibling;
  return previous !== null && previous.matches(FIELD_ROOT) ? previous : null;
}

/**
 * Moves focus to the first refused field in DOCUMENT order, and answers whether any control rendered the path.
 * Not `reportValidity()`: it speaks for native validation alone, which `aria` removes.
 */
export function focusFirstRefusal(form: HTMLFormElement, fieldErrors: FieldErrors): boolean {
  let rendered = false;

  for (const control of Array.from(form.elements)) {
    const name = control.getAttribute("name");
    // `hasOwn` and not `in`: `in` walks the prototype, so a field named `constructor` would match an empty map.
    if (name === null || !Object.hasOwn(fieldErrors, name)) continue;

    // Kept separate from the focus attempt: a field whose only control cannot take focus still SHOWS the
    // message, so the toast below must not claim nothing renders the path.
    rendered = true;
    if (control instanceof HTMLElement && takeFocus(control)) return true;

    // The named element is not always one a caret can reach, and for a `Select` it is one no screen reader
    // reads. The visible control is a sibling of it inside the same field.
    for (const candidate of fieldRootOf(control)?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []) {
      if (takeFocus(candidate)) return true;
    }
  }

  return rendered;
}

/**
 * The refused paths no control in the form carries, however many others one does: what has to be announced rather
 * than shown. With no form mounted, every one of them.
 */
export function unshownPaths(form: HTMLFormElement | null, fieldErrors: FieldErrors): string[] {
  const named = new Set(Array.from(form?.elements ?? [], (control) => control.getAttribute("name")));

  return Object.keys(fieldErrors).filter((path) => !named.has(path));
}

/**
 * Focus has to move from an effect rather than from the submit handler: the message is rendered by the render this
 * state change causes, and focusing a field before it can announce one leaves a screen reader with nothing to read.
 */
export function useServerFieldErrors(failureTitle?: string) {
  // One state rather than two: the effect answers the map with the sentence, and the toast, that arrived beside it.
  const [refusal, setRefusal] = useState<{
    fieldErrors: FieldErrors;
    unplaced: string | undefined;
    owed: OwedToast | undefined;
    announced: boolean;
  }>({
    fieldErrors: {},
    unplaced: undefined,
    owed: undefined,
    announced: false,
  });
  const formRef = useRef<HTMLFormElement>(null);

  // The caller's own word for a failed save, defaulted HERE rather than in the signature: a title
  // resolved at the raise is one `docs/frontend/spec.md :: I42`'s register can read.
  const raiseOwnTitle = useCallback<RaiseFailure>((shown) => appToast.failure(failureTitle ?? DEFAULT_FAILURE_TITLE, shown), [failureTitle]);

  /**
   * A map with no failure behind it: a blocked press's, or a clear. `announced` where the caller's own toast already
   * says what no control shows, so a press raises one toast rather than two.
   */
  const setFieldErrors = useCallback((fieldErrors: FieldErrors, { announced = false }: { announced?: boolean } = {}) => {
    setRefusal({ fieldErrors, unplaced: undefined, owed: undefined, announced });
  }, []);

  /**
   * A failed press and its announcement, owned here so no call site raises a second toast beside the
   * one this hook raises for a map nothing renders (`docs/frontend/spec.md :: I344`).
   */
  const answerFailure = useCallback(
    (failure: ActionFailure, { raise = raiseOwnTitle, evenWhenShown = false }: FailureAnnouncement = {}) => {
      const fieldErrors = failure.fieldErrors ?? {};

      // Raised now where no map waits on a render: a caller closing its editor on the failure would
      // unmount the effect below before it ran.
      if (Object.keys(fieldErrors).length === 0) {
        setRefusal({ fieldErrors, unplaced: undefined, owed: undefined, announced: false });
        raise(failure);
        return;
      }

      setRefusal({ fieldErrors, unplaced: failure.unplacedError, owed: { failure, raise, evenWhenShown }, announced: false });
    },
    [raiseOwnTitle],
  );

  useEffect(() => {
    const form = formRef.current;
    const { fieldErrors, unplaced, owed, announced } = refusal;
    const rendered = Object.keys(fieldErrors).length > 0 && form !== null && focusFirstRefusal(form, fieldErrors);
    const unshown = unshownPaths(form, fieldErrors);

    // Some refused path no control shows, whatever the others show: marked alone, it is announced nowhere. A
    // blocked press as well as a failed write, a draft's own schema refusing a path the form never rendered.
    if (unshown.length > 0 && !announced) {
      const said = unshownRefusal(unshown.map((path) => fieldErrors[path] ?? ""));
      if (owed !== undefined) owed.raise({ ...owed.failure, error: unplaced ?? said });
      else appToast.danger(failureTitle ?? DEFAULT_FAILURE_TITLE, { description: said });
      return;
    }

    // A control shows the refusal, which speaks for the press unless the failure carries more than it,
    // and the sentence for a map nothing shows is then false.
    if (rendered && owed?.evenWhenShown === true) owed.raise({ ...owed.failure, unplacedError: undefined });
  }, [refusal, failureTitle]);

  return { fieldErrors: refusal.fieldErrors, setFieldErrors, answerFailure, formRef };
}

/** Whether a failed action result carried anything a field could display. */
export function hasFieldErrors(fieldErrors: FieldErrors | undefined): fieldErrors is FieldErrors {
  return !!fieldErrors && Object.keys(fieldErrors).length > 0;
}
