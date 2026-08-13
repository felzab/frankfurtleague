"use client";

/**
 * TEAMS · the team page's back control
 *
 * A leaf of its own so that the page composing it stays a Server Component: `useRouter` is the whole
 * of what needs the browser here. History rather than a named destination, for the reason the app's
 * other detail pages give — this one is reached from the table, the grids and every match card — and
 * a named one only where a cold entry leaves no history to read.
 */
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

export function TeamDetailsBackButton() {
  const router = useRouter();

  return (
    <Button
      onPress={() => {
        // No blur first, though the admin editors' `leavePage` opens with one: theirs clears
        // react-aria's `data-focused` off a form field the router can hand back, and this page
        // has no field — the control being pressed is what holds focus here.

        // `router.back()` is a silent no-op on a cold entry, and this page gets linked to.
        // `history.length` is the platform's only signal; a fresh tab reads 1. The team list
        // is where the page is most often reached from, so it is the fallback.
        if (window.history.length > 1) router.back();
        else router.push("/dashboard/teams");
      }}
      // `-mb-3` against the page's `gap-y-8`: a control that leaves the page sits closer to what it
      // leaves than two sections of the page sit to each other.
      className="bg-surface border-border text-foreground data-hovered:bg-hover fluid-xs -mb-3 flex h-10 w-fit items-center gap-x-2 rounded-xl border px-4 font-bold shadow-sm transition-colors">
      <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
      <span>Zurück</span>
    </Button>
  );
}
