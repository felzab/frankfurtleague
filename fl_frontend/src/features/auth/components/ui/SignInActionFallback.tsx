"use client";

import { Button } from "@heroui/react/button";

import { formButton } from "@/shared/components/ui/formButtons";

/**
 * React parses a server action's answer before any application code runs, so a rejected send reaches
 * the boundary carrying nothing of the response: no status, no body. That the answer was not ours is
 * all this can say.
 */
export function SignInActionFallback({ onRetry }: { onRetry: () => void }) {
  return (
    // `alert`, not the sibling panel's `status`: this stands here because the visitor pressed send.
    <div
      role="alert"
      className="flex flex-col items-center gap-y-4 py-6 text-center">
      <h2 className="fluid-lg font-extrabold tracking-tight text-pretty text-foreground">Die Website ist gerade nicht erreichbar.</h2>

      <Button
        type="button"
        variant="secondary"
        onPress={onRetry}
        className={formButton({ intent: "cancel" })}>
        Erneut versuchen
      </Button>
    </div>
  );
}
