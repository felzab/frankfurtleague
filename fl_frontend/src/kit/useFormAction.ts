"use client";

import { startTransition, useActionState, useLayoutEffect, useRef, useState } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";

import { COPY } from "@/core/copy";

import { isEdgeRefusal } from "./edgeRefusal";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";

/**
 * Anything the action throws is answered with the stale-page line, and the page is read again: the press may
 * have reached the server and written before its answer was lost, and only the fresh page shows whether it
 * did, where a second press could repeat the write. Next's redirect and not-found pass through, and the edge's
 * own rate refusal, which reached nothing behind the edge, says so and when to retry, reading nothing again.
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
      if (isEdgeRefusal(thrown)) return { ok: false, reason: COPY.shared.fehler.zuVieleVersuche };
      refresh();
      return { ok: false, reason: COPY.shared.fehler.veraltet };
    }
  };
}

/** A form's status line: its words and its tone, or nothing. `changes` is the editor's count of unsaved fields. */
export type FormStatus = { tone: "changes" | "saved" | "error"; text: Copy } | null;

/**
 * The status line of a send. One the browser kept back for a field's own rule points at the fields, as does
 * a server refusal its fields carry, since the fields say what and the line where to look; any other refusal
 * says its reason, or the shared failure line; a done one says what else the write moved, or „Gespeichert“.
 * Nothing for no answer, nor while a send is on its way: the last answer is none to the press still running,
 * and the line, a polite live region, is announced only where its words change, so the same refusal twice
 * goes in afresh after the empty line or a screen reader stays silent on the second.
 */
export function statusOf(answer: ActionAnswer<unknown> | null, isBlocked: boolean, isPending: boolean): FormStatus {
  if (isBlocked) return { tone: "error", text: COPY.vorlage.felderPruefen };
  if (answer === null || isPending) return null;
  if (answer.ok) return { tone: "saved", text: answer.note ?? COPY.shared.gespeichert };
  return {
    tone: "error",
    text: answer.fieldErrors === undefined ? (answer.reason ?? COPY.shared.fehler.unerwartet) : COPY.vorlage.felderPruefen,
  };
}

type Step<Payload> = { kind: "send"; payload: Payload } | { kind: "reset" };

/**
 * The one way a browser form posts: a server action through React's `useActionState`, whose rejection would
 * otherwise reach the nearest error boundary with nothing to say, so every throw answers in the form's own
 * status line, as `answering` words it. Every form kind takes it: the editor's bar, a Konto box, and the
 * one-shot submit.
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
