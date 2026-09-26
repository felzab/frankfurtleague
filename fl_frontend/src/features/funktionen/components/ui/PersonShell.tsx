"use client";

import { signOutAction } from "@/features/auth/actions";
import { AppShell } from "@/shared/components/layout/shell/AppShell";
import { FunktionSwitcher } from "@/shared/components/layout/sidemenu/FunktionSwitcher";

import { PERSON_SHELL_FALLBACK, PERSON_SIDEMENU_ICONS } from "../../constants";

import type { FunktionOrt } from "@/shared/components/layout/sidemenu/FunktionSwitcher";
import type { SidemenuStructure } from "@/shared/types/types";
import type React from "react";
import type { PersonIconName } from "../../constants";

/**
 * A client wrapper for `AdminShell`'s reason: the icons and the sign-out action cross no server
 * boundary as props. The structure arrives as plain data, selected per request by the Funktionen held.
 */
export function PersonShell({
  structure,
  orte,
  children,
}: {
  structure: SidemenuStructure<PersonIconName>;
  /** The places the person's Funktionen lead to (`fl_frontend/src/features/funktionen/utils.ts :: funktionOrteOf`). */
  orte: readonly FunktionOrt[];
  children: React.ReactNode;
}) {
  return (
    <AppShell
      structure={structure}
      linkPrefix="/bereich"
      iconDictionary={PERSON_SIDEMENU_ICONS}
      // A person's pages are scoped to the person rather than to a season, so no season slot stands
      // and no link carries one.
      saisonMetadataDisplay={null}
      // No way to `/bereich` beneath the places: this shell's own „Übersicht“ entry is that address.
      funktionSwitcher={
        <FunktionSwitcher
          orte={orte}
          ohneOrt={PERSON_SHELL_FALLBACK.label}
          mitBereich={false}
        />
      }
      keepsSaisonQuery={false}
      fallbackTitle={PERSON_SHELL_FALLBACK.label}
      fallbackHint={PERSON_SHELL_FALLBACK.hint}
      onSignOut={signOutAction}>
      {children}
    </AppShell>
  );
}
