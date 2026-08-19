"use client";

import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

/** Its own leaf so the page composing it stays a Server Component; `useRouter` is all that needs the browser. */
export function TeamDetailsBackButton() {
  const router = useRouter();

  return (
    <Button
      onPress={() => {
        // `router.back()` is a silent no-op on a cold entry, and this page gets linked to.
        // `history.length` is the platform's only signal; a fresh tab reads 1.
        if (window.history.length > 1) router.back();
        else router.push("/dashboard/teams");
      }}
      // `-mb-3` against the page's `gap-y-8`: a control that leaves the page sits closer to what it
      // leaves than two sections do to each other.
      className="bg-surface border-border text-foreground data-hovered:bg-hover fluid-xs -mb-3 flex h-10 w-fit items-center gap-x-2 rounded-xl border px-4 font-bold shadow-sm transition-colors">
      <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
      <span>Zurück</span>
    </Button>
  );
}
