"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { formButton } from "@/shared/components/ui/formButtons";

/** Its own leaf so the page composing it stays a Server Component; `useRouter` is all that needs the browser. */
export function TeamDetailsBackButton() {
  const router = useRouter();
  const [isLeaving, startLeaving] = useTransition();

  return (
    <Button
      onPress={() => {
        // The pending flag is what ends react-aria's hover: it clears `data-hovered` when a control
        // turns disabled, and no `pointerleave` follows a click that leaves.
        startLeaving(() => {
          // `router.back()` is a silent no-op on a cold entry, and this page gets linked to.
          // `history.length` is the platform's only signal; a fresh tab reads 1.
          if (window.history.length > 1) router.back();
          else router.push("/dashboard/teams");
        });
      }}
      isDisabled={isLeaving}
      // `-mb-3` against the page's `gap-y-8`: a control that leaves the page sits closer to what it
      // leaves than two sections do to each other.
      className={`${formButton({ intent: "nav", size: "sm" })} -mb-3 w-fit gap-x-2`}>
      <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
      <span>Zurück</span>
    </Button>
  );
}
