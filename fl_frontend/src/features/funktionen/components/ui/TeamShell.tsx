"use client";

import { signOutAction } from "@/features/auth/actions";
import { AppShell } from "@/shared/components/layout/shell/AppShell";
import { FunktionSwitcher } from "@/shared/components/layout/sidemenu/FunktionSwitcher";

import { TEAM_SHELL_FALLBACK, TEAM_SHELL_REFUSAL, TEAM_SIDEMENU_ICONS } from "../../constants";
import { teamHref } from "../../teamSeats";
import { SaisonChipSlot } from "./SaisonChipSlot";

import type { FunktionOrt } from "@/shared/components/layout/sidemenu/FunktionSwitcher";
import type { SidemenuStructure } from "@/shared/types/types";
import type React from "react";
import type { TeamIconName } from "../../constants";

/**
 * A client wrapper for `AdminShell`'s reason: the icons and the sign-out action cross no server
 * boundary as props. The structure and the season arrive as plain data, selected per request.
 */
export function TeamShell({
  teamId,
  saisonId,
  structure,
  saison,
  isRefused,
  orte,
  children,
}: {
  teamId: string;
  saisonId: string;
  structure: SidemenuStructure<TeamIconName>;
  /** The season as a seat there reports it, `null` where the person holds none and the address is all there is. */
  saison: { isLaufend: boolean } | null;
  /**
   * Whether the page is the forbidden panel, said rather than read off `saison`: the area's crash
   * panel holds no season either, and its bar must not tell a seat holder they hold no seat.
   */
  isRefused: boolean;
  /** The places the person's Funktionen lead to (`fl_frontend/src/features/funktionen/utils.ts :: funktionOrteOf`). */
  orte: readonly FunktionOrt[];
  children: React.ReactNode;
}) {
  // The fallback heads every address the structure claims no entry for, the forbidden panel's among them.
  const fallback = isRefused ? TEAM_SHELL_REFUSAL : TEAM_SHELL_FALLBACK;

  return (
    <AppShell
      structure={structure}
      linkPrefix={teamHref(teamId, saisonId)}
      // The season is the address's own segment, so no link carries it a second time as a query.
      keepsSaisonQuery={false}
      iconDictionary={TEAM_SIDEMENU_ICONS}
      // No chip over an address the person holds nothing on: its segment is whatever was typed there.
      saisonMetadataDisplay={
        saison === null ? null : (
          <SaisonChipSlot
            saisonId={saisonId}
            isLaufend={saison.isLaufend}
          />
        )
      }
      funktionSwitcher={
        <FunktionSwitcher
          orte={orte}
          ohneOrt={TEAM_SHELL_FALLBACK.label}
          mitBereich
        />
      }
      fallbackTitle={fallback.label}
      fallbackHint={fallback.hint}
      onSignOut={signOutAction}>
      {children}
    </AppShell>
  );
}
