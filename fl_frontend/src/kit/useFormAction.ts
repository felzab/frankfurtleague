"use client";

import { startTransition, useActionState, useLayoutEffect, useRef } from "react";
import { unstable_rethrow } from "next/navigation";

import { COPY } from "@/core/copy";

import type { Copy } from "@/core/copy";

/**
 * What a server action answers a form: done, with what the page needs next, or not done, with each field's
 * message by the field's `name` and the one line the status line shows. A refusal a person can cause from
 * the screen brings its reason, a stale read the stale-page line, anything unexpected the shared failure
 * line; a refusal for its fields alone may leave the line to the form.
 */
export type ActionAnswer<Value = undefined> =
  { ok: true; value: Value } | { ok: false; fieldErrors?: Readonly<Record<string, Copy>>; reason?: Copy };

/** Anything the action throws becomes the unexpected-failure answer, but Next's redirect and not-found pass through. */
export function answering<Payload, Value>(
  action: (payload: Payload) => Promise<ActionAnswer<Value>>,
): (payload: Payload) => Promise<ActionAnswer<Value>> {
  return async (payload) => {
    try {
      return await action(payload);
    } catch (thrown) {
      // A redirect or a not-found is how the action leads on; React hands it to Next's boundary.
      unstable_rethrow(thrown);
      return { ok: false, reason: COPY.shared.fehler.unerwartet };
    }
  };
}

type Step<Payload> = { kind: "send"; payload: Payload } | { kind: "reset" };

/**
 * The one way a browser form posts: a server action through React's `useActionState`, whose rejection would
 * otherwise reach the nearest error boundary with nothing to say, so every throw answers as the unexpected
 * failure in the form's own status line. Every form kind takes it: the editor's bar, a Konto box, and the
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
  const [answer, dispatch, isPending] = useActionState<ActionAnswer<Value> | null, Step<Payload>>(
    async (_previous, step) => (step.kind === "reset" ? null : answering(action)(step.payload)),
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
    submit: (payload: Payload) => startTransition(() => dispatch({ kind: "send", payload })),
    /** Clears the answer, as after a discard. */
    reset: () => startTransition(() => dispatch({ kind: "reset" })),
    isPending,
  };
}
