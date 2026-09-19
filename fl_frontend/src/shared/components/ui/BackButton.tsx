"use client";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { formButton } from "@/shared/components/ui/formButtons";
import { usePageExit } from "@/shared/hooks/useEditorExit";

import type { PageExitOptions } from "@/shared/hooks/useEditorExit";

/**
 * **A component and never a class recipe**: the guard has to travel with the markup, or a page
 * spelling the pill out by hand gets one that is dead on a cold entry.
 */
export function BackButton({ fallbackHref, spacing = "mb-6" }: PageExitOptions & { spacing?: "mb-6" | "mb-0" }) {
  const { isLeaving, leavePage } = usePageExit({ fallbackHref: fallbackHref });

  return (
    <Button
      onPress={leavePage}
      // The pending flag is what ends react-aria's hover (`docs/frontend/spec.md :: I68`).
      isDisabled={isLeaving}
      // `mb-0` is for a page whose own `gap-y-*` already parts its sections, that gap being the
      // whole of the distance (`docs/frontend/spec.md` §1.20).
      className={`${formButton({ intent: "nav", size: "sm" })} ${spacing} w-fit gap-x-2`}>
      <ArrowUturnCwLeft
        aria-hidden="true"
        className="size-4 shrink-0"
      />
      <span>Zurück</span>
    </Button>
  );
}
