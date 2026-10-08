"use client";

import { Button } from "@heroui/react/button";

import { formButton } from "@/shared/components/ui/formButtons";
import { reloadDocument } from "@/shared/utils/documentNavigation";

/**
 * A rejected send reaches the boundary before any application code runs, as an error with no status,
 * its message Next's own or an edge's `text/plain` body. This reads neither: that the answer was not
 * ours is all it can say.
 */
export function SignInActionFallback() {
  return (
    // `alert`, not the sibling panel's `status`: this stands here because the visitor pressed send.
    <div
      role="alert"
      className="flex flex-col items-center gap-y-4 py-6 text-center">
      <h2 className="fluid-lg font-extrabold tracking-tight text-pretty text-foreground">Die Website ist gerade nicht erreichbar.</h2>

      {/* A reload and never the boundary's reset: a reset sends nothing, and the press after it would send
          the same stale action id, where a new document carries the running build's (`docs/frontend/spec.md` §1.3). */}
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
