"use client";

import { KONTO_HREF } from "@/core/kontoHref";
import { signOut } from "@/features/auth/signOut";
import { AppShell } from "@/shared/components/layout/shell/AppShell";
import { SidemenuEntries } from "@/shared/components/layout/sidemenu/SidemenuNavLinks";

import { PERSON_SHELL_FALLBACK, PERSON_SIDEMENU_ICONS } from "../../constants";

import type { SidemenuHint, SidemenuStructure } from "@/shared/types/types";
import type React from "react";
import type { PersonIconName } from "../../constants";

/**
 * A client wrapper for `AdminShell`'s reason: the icons and the sign-out cross no server
 * boundary as props. What the person's Funktionen decide arrives as slots, each streamed on its own.
 */
export function PersonShell({
  structure,
  entries,
  funktionSwitcher,
  fallback = PERSON_SHELL_FALLBACK,
  children,
}: {
  /** What the bar's title resolves against, and the rail lists where no `entries` stands. */
  structure: SidemenuStructure<PersonIconName>;
  /** The entries the person holds (`fl_frontend/src/features/funktionen/constants.ts :: personStructureFor`). */
  entries?: React.ReactNode;
  funktionSwitcher: React.ReactNode;
  /** What the bar reads where no entry heads the address: a missing page's words, or the crash panel's own. */
  fallback?: { label: string; hint: SidemenuHint };
  children: React.ReactNode;
}) {
  return (
    <AppShell
      structure={structure}
      entries={entries}
      linkPrefix="/bereich"
      iconDictionary={PERSON_SIDEMENU_ICONS}
      // A person's pages are scoped to the person rather than to a season, so no season slot stands
      // and no link carries one.
      saisonMetadataDisplay={null}
      funktionSwitcher={funktionSwitcher}
      keepsSaisonQuery={false}
      fallbackTitle={fallback.label}
      fallbackHint={fallback.hint}
      kontoHref={KONTO_HREF}
      onSignOut={signOut}>
      {children}
    </AppShell>
  );
}

/** The person area's entries, which a layout builds from the person's Funktionen: only this area's icons draw them. */
export function PersonSidemenuEntries({ structure }: { structure: SidemenuStructure<PersonIconName> }) {
  return (
    <SidemenuEntries
      structure={structure}
      iconDictionary={PERSON_SIDEMENU_ICONS}
    />
  );
}
