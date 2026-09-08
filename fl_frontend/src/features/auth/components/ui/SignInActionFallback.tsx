"use client";

import { Button } from "@heroui/react";

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
      {/* A glyph here would answer what the sentence refuses to, whether the link went out: the two
          in this card both name a mailbox. */}
      <h2 className="fluid-lg text-foreground font-extrabold tracking-tight text-pretty">Die Antwort auf Deine Anmeldung kam nicht von uns.</h2>

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
