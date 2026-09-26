"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";

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
}): { isReactivating: boolean; reactivate: (payload: TPayload) => void } {
  const [isReactivating, startReactivating] = useTransition();
  const router = useRouter();

  const reactivate = (payload: TPayload) => {
    startReactivating(async () => {
      // A rejected action may still have saved, and uncaught here it takes the page down with it.
      const res = await action(payload).catch(rejectedWrite(router));

      if (!res.success) {
        appToast.failure(`${noun} nicht reaktiviert`, res);
        return;
      }

      const title = `${noun} reaktiviert`;
      // A warning where the link the return minted did not leave, graded and titled as the save's
      // `offerUndo` grades the same send: the person holds no working link and nobody else is told.
      const warn = res.versandFehlgeschlagen === true;
      const raise = warn ? appToast.warning : appToast.success;
      // Dropped where the action's sentence IS the title: every row-level reactivation answers with
      // the words the title already carries, and only the squad row answers with a detail.
      raise(warn ? "Mit Folgen reaktiviert" : title, { description: res.message === title ? undefined : res.message });
    });
  };

  return { isReactivating, reactivate };
}
