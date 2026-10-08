"use client";

import { useActionState } from "react";

import { edgeRefusedSend } from "@/shared/utils/actionError";

import type { ActionFailure } from "@/shared/types/types";

/** Compiles only where an `ActionFailure` is a `State`: the edge's answer is made the action's state. */
type FailureIsState<State> = [ActionFailure] extends [State] ? [] : [never];

/**
 * `action`, its rejection by the edge's own 429 answered as its state. React hands an action's rejection
 * to the nearest error boundary, which reads nothing of it; every other rejection still goes there.
 */
export function answeringEdgeRefusal<Prior, State, Payload>(
  action: (state: Prior, payload: Payload) => State | Promise<State>,
  ..._failureIsState: FailureIsState<Awaited<State>>
): (state: Prior, payload: Payload) => Promise<Awaited<State>> {
  return (state, payload) =>
    Promise.resolve(action(state, payload)).catch((rejection: unknown) => {
      const refused = edgeRefusedSend(rejection);
      if (refused === null) throw rejection;

      // Sound by `FailureIsState`, which TypeScript cannot carry into a generic body.
      return refused as Awaited<State>;
    });
}

/**
 * `useActionState` for every send a form dispatches, the one way the codebase takes it
 * (`fl_frontend/eslint.config.mjs :: ACTION_STATE_BAN`): an action rejecting outside a `.catch` has no
 * other reader.
 */
export function useAnsweredActionState<State, Payload = void>(
  action: (state: Awaited<State>, payload: Payload) => State | Promise<State>,
  initialState: Awaited<State>,
  ..._failureIsState: FailureIsState<Awaited<State>>
): [state: Awaited<State>, dispatch: (payload: Payload) => void, isPending: boolean] {
  return useActionState(answeringEdgeRefusal(action, ..._failureIsState), initialState);
}
