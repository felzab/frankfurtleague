"use client";

import { Button } from "@heroui/react/button";

import { formButton } from "@/shared/components/ui/formButtons";
import { reloadDocument } from "@/shared/utils/documentNavigation";

/**
 * React parses a server action's answer before any application code runs, so a rejected send reaches
 * the boundary carrying nothing of the response: no status, no body. That the answer was not ours is
 * all this can say.
 */
export function SignInActionFallback() {
  return (
    // `alert`, not the sibling panel's `status`: this stands here because the visitor pressed send.
    <div
      role="alert"
      className="flex flex-col items-center gap-y-4 py-6 text-center">
      <h2 className="fluid-lg font-extrabold tracking-tight text-pretty text-foreground">Die Website ist gerade nicht erreichbar.</h2>

      {/* A reload and never the boundary's reset, which sends the same action again: one from a build
          other than the server's fails again, and a challenged POST stays uncleared until a page load. */}
      <Button
        type="button"
        variant="secondary"
        onPress={reloadDocument}
        className={formButton({ intent: "cancel" })}>
        Erneut versuchen
      </Button>
    </div>
  );
}
