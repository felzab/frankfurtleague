"use client";

import { startTransition, useActionState, useLayoutEffect, useRef, useState } from "react";
import { unstable_isUnrecognizedActionError, unstable_rethrow, useRouter } from "next/navigation";

import { COPY } from "@/core/copy/shared";

import { isEdgeRefusal } from "./edgeRefusal";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";

/**
 * A throw the frontend answered is worded with the stale-page line, and the page is read again: an action that threw
 * on the server, whose error carries Next's `digest`, may have written first, and only the fresh page shows whether it
 * did; an action Next does not recognise means a newer build serves the page. Any other throw is a press no answer of
 * the frontend's reached, such as the edge's 502 or a failed fetch, and is the unexpected failure with nothing read
 * again: Next turns a read the frontend cannot answer into a document load, which puts the edge's error page over the
 * form and every typed answer. Next's redirect and not-found pass through, and the edge's own rate refusal, which
 * reached nothing behind the edge, says so and when to retry, reading nothing again.
 */
export function answering<Payload, Value>(
  action: (payload: Payload) => Promise<ActionAnswer<Value>>,
  refresh: () => void,
): (payload: Payload) => Promise<ActionAnswer<Value>> {
  return async (payload) => {
    try {
      return await action(payload);
    } catch (thrown) {
      // A redirect or a not-found is how the action leads on; React hands it to Next's boundary.
      unstable_rethrow(thrown);
      if (isEdgeRefusal(thrown)) return { ok: false, reason: COPY.shared.failure.tooManyAttempts };
      // React's Flight client sets `digest` only on an error the server's own answer carried.
      const frontendAnswered =
        unstable_isUnrecognizedActionError(thrown) || (thrown instanceof Error && "digest" in thrown && typeof thrown.digest === "string");
      if (!frontendAnswered) return { ok: false, reason: COPY.shared.failure.unexpected };
      refresh();
      return { ok: false, reason: COPY.shared.failure.stale };
    }
  };
}

/** An act's outcome as a hue: done, partly done (an answer's `warn`), or not done. */
export type AnswerTone = "success" | "warn" | "danger";

/**
 * An act's answer as the line saying it: `done` or the note a done answer brings, else the refusal's reason, each in
 * the warn tone where the act partly happened. The one rule from an answer to its tone and words, so a form's status
 * line, a question's line and a toast never word one answer two ways. `done` is a form's „Gespeichert“ unless the act
 * names its own word, and a done answer naming the act it did instead (`done`) brings that word.
 */
export function answerLine(answer: ActionAnswer<unknown>, done: Copy = COPY.shared.saved): { tone: AnswerTone; text: Copy } {
  if (answer.ok) return { tone: answer.warn === true ? "warn" : "success", text: answer.note ?? answer.done ?? done };
  return { tone: answer.warn === true ? "warn" : "danger", text: answer.reason ?? COPY.shared.failure.unexpected };
}

/**
 * A form's status line: its words and its tone, or nothing. `changes` is the editor's count of unsaved fields, which no
 * answer and no toast takes.
 */
export type FormStatus = { tone: "changes" | AnswerTone; text: Copy } | null;

/**
 * The status line of a send. One the browser kept back for a field's own rule points at the fields, as does
 * a server refusal its fields carry, since the fields say what; a refusal with a reason no box says says that
 * reason, the boxes saying theirs beside it, and any other the shared failure line.
 * Nothing for no answer, for a done one, which its toast or an editor's save bar says, for a save held back for the
 * question its answer asks, nor while a send is on its way: the last answer is none to the press still running.
 */
export function statusOf(answer: ActionAnswer<unknown> | null, isBlocked: boolean, isPending: boolean): FormStatus {
  if (isBlocked) return { tone: "danger", text: COPY.template.checkFields };
  if (answer === null || answer.ok || isPending) return null;
  // A save held back for its question: the question says what, and nothing failed.
  if (answer.ask !== undefined) return null;
  // A passkey sheet the person closed: the act never ran, and nothing failed.
  if (answer.closed === true) return null;
  if (answer.fieldErrors === undefined) return answerLine(answer);
  // A reason beside the fields stands before their pointer, being said nowhere else, unless a box already says it.
  const { reason } = answer;
  const unsaid = reason !== undefined && !Object.values(answer.fieldErrors).includes(reason);
  return { tone: "danger", text: unsaid ? reason : COPY.template.checkFields };
}

type Step<Payload> = { kind: "send"; payload: Payload } | { kind: "reset" };

/**
 * The one way a browser form posts: a server action through React's `useActionState`, whose rejection would
 * otherwise reach the nearest error boundary with nothing to say, so every throw answers in the form's own
 * status line, as `answering` words it.
 *
 * Next keeps a page the person left in a hidden `Activity`. With `resetOnLeave`, an answer already shown is
 * cleared as the page hides, so a „Gespeichert“ never greets a later visit; a draft not yet sent stays, which
 * is the documented reset for a status message. The one-shot submit keeps its answer, which replaced the form.
 */
export function useFormAction<Payload, Value = undefined>(
  action: (payload: Payload) => Promise<ActionAnswer<Value>>,
  { resetOnLeave }: { resetOnLeave: boolean },
) {
  const router = useRouter();
  // The browser kept the send back for a field's own rule; cleared by the next send.
  const [isBlocked, setBlocked] = useState(false);
  const [answer, dispatch, isPending] = useActionState<ActionAnswer<Value> | null, Step<Payload>>(
    async (_previous, step) => (step.kind === "reset" ? null : answering(action, router.refresh)(step.payload)),
    null,
  );

  // Read by the cleanup below, which closes over the first render's values.
  const shown = useRef(false);
  useLayoutEffect(() => {
    shown.current = answer !== null;
  });

  useLayoutEffect(
    () => () => {
      if (resetOnLeave && shown.current) startTransition(() => dispatch({ kind: "reset" }));
    },
    [resetOnLeave, dispatch],
  );

  return {
    /** The last answer, `null` before the first send and after a reset. */
    answer,
    /** Sends `payload`; the answer replaces the previous one once the action settles. */
    submit: (payload: Payload) => {
      setBlocked(false);
      startTransition(() => dispatch({ kind: "send", payload }));
    },
    /** The browser kept the send back for a field's own rule, which the status line points at until the next send. */
    block: () => setBlocked(true),
    isBlocked,
    /** Clears the answer, as after a discard. */
    reset: () => startTransition(() => dispatch({ kind: "reset" })),
    isPending,
  };
}
