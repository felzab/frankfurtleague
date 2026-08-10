"use client";

/**
 * TEAMS · the team page's back control
 *
 * A leaf of its own so that the page composing it stays a Server Component: `useRouter` is the whole
 * of what needs the browser here. History rather than a named destination, for the reason the app's
 * other detail pages give — this one is reached from the table, the grids and every match card.
 */
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

export function TeamDetailsBackButton() {
  const router = useRouter();

  return (
    <Button
      onPress={() => {
        router.back();
      }}
      // `-mb-3` against the page's `gap-y-8`: a control that leaves the page sits closer to what it
      // leaves than two sections of the page sit to each other, which is the spacing this had before
      // it moved into a component of its own.
      className="bg-surface border-border text-foreground hover:bg-muted fluid-xs -mb-3 flex h-10 w-fit items-center gap-x-2 rounded-xl border px-4 font-bold shadow-sm transition-colors">
      <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
      <span>Zurück</span>
    </Button>
  );
}
