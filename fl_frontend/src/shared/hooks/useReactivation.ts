"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { STEP_UP_REFUSED } from "@/shared/components/ui/stepUp";
import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";
import { focusAfterWrite } from "@/shared/utils/focusAfterWrite";

import { useStepUp } from "./useStepUp";

import type { ActionResult } from "@/shared/types/types";

/**
 * The reactivation every retired row offers: one transition, and the pair of announcements, composed
 * here rather than per row — a row spelling its own pair drops the detail its action answers with.
 */
export function useReactivation<TPayload>({
  action,
  noun,
}: {
  action: (payload: TPayload) => Promise<ActionResult<{ versandFehlgeschlagen?: boolean }>>;
  /** What comes back, nominative and without an article: both titles are built around it. */
  noun: string;
}): {
  isReactivating: boolean;
  /** The passkey prompt a return minting a link opened is open, and nothing has been sent. */
  isPrompting: boolean;
  /** `stepUp` where this return is a step-up write (`docs/frontend/spec.md :: I432`). */
  reactivate: (payload: TPayload, declared?: { stepUp: boolean }) => void;
} {
  const [isReactivating, startReactivating] = useTransition();
  const stepUp = useStepUp();
  const router = useRouter();

  const reactivate = (payload: TPayload, { stepUp: due }: { stepUp: boolean } = { stepUp: false }) => {
    // Read ahead of the passkey prompt, which takes the focus off the pressed control while it is open.
    const landing = focusAfterWrite();
    stepUp.confirmThen(
      due,
      () =>
        startReactivating(async () => {
          // A rejected action may still have saved, and uncaught here it takes the page down with it.
          const res = await action(payload).catch(rejectedWrite(router));

          if (!res.success) {
            appToast.failure(`${noun} nicht reaktiviert`, res);
            return;
          }

          landing.landed();
          const title = `${noun} reaktiviert`;
          // A warning where the link the return minted did not leave, graded and titled as the save's
          // `offerUndo` grades the same send: the person holds no working link and nobody else is told.
          const warn = res.versandFehlgeschlagen === true;
          const raise = warn ? appToast.warning : appToast.success;
          // Dropped where the action's sentence IS the title: every row-level reactivation answers with
          // the words the title already carries, and only the squad row answers with a detail.
          raise(warn ? "Mit Folgen reaktiviert" : title, { description: res.message === title ? undefined : res.message });
        }),
      // In a toast like every other outcome here: a row's restore is an icon with no room beside it.
      () => appToast.failure(`${noun} nicht reaktiviert`, { error: STEP_UP_REFUSED }),
    );
  };

  return { isReactivating: isReactivating || stepUp.isPrompting, isPrompting: stepUp.isPrompting, reactivate };
}
