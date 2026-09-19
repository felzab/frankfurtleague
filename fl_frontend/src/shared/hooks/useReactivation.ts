"use client";

import { useTransition } from "react";

import { appToast } from "@/shared/utils/appToast";

import type { ActionResult } from "@/shared/types/types";

/**
 * The reactivation every retired row offers: one transition, and the pair of announcements.
 *
 * Eight call sites composed both sentences with nothing but a noun between them, and seven of them
 * dropped the detail their action answers with.
 */
export function useReactivation<TPayload>({
  action,
  noun,
}: {
  action: (payload: TPayload) => Promise<ActionResult>;
  /** What comes back, nominative and without an article: both titles are built around it. */
  noun: string;
}): { isReactivating: boolean; reactivate: (payload: TPayload) => void } {
  const [isReactivating, startReactivating] = useTransition();

  const reactivate = (payload: TPayload) => {
    startReactivating(async () => {
      const res = await action(payload);

      if (!res.success) {
        appToast.danger(`${noun} nicht reaktiviert`, { description: res.error });
        return;
      }

      const title = `${noun} reaktiviert`;
      // Dropped where the action's sentence IS the title: every row-level reactivation answers with
      // the words the title already carries, and only the squad row answers with a detail.
      appToast.success(title, { description: res.message === title ? undefined : res.message });
    });
  };

  return { isReactivating, reactivate };
}
