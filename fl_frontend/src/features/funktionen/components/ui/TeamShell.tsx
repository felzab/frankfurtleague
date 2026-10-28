"use client";

import { KONTO_HREF } from "@/core/kontoHref";
import { AppShell } from "@/shared/components/layout/shell/AppShell";
import { ShellHeading } from "@/shared/components/layout/shell/ShellHeading";
import { SidemenuEntries } from "@/shared/components/layout/sidemenu/SidemenuNavLinks";
import { signOut } from "@/shared/utils/signOut";

import { TEAM_SHELL_FALLBACK, TEAM_SHELL_REFUSAL, TEAM_SIDEMENU_ICONS, TEAM_SIDEMENU_STRUCTURE } from "../../constants";
import { teamHref } from "../../teamSeats";

import type { AddressParams } from "@/shared/components/layout/shell/linkPrefix";
import type { SidemenuStructure } from "@/shared/types/types";
import type React from "react";
import type { TeamIconName } from "../../constants";

/** Each team and season is a root of its own, read off the address its pages stand at. */
const teamPrefixOf = ({ team_id, saison_id }: AddressParams): string => teamHref(String(team_id), String(saison_id));

/**
 * A client wrapper for `AdminShell`'s reason: the icons and the sign-out cross no server
 * boundary as props. What the seats decide arrives as slots, each streamed on its own.
 */
export function TeamShell({
  heading,
  entries,
  saisonMetadataDisplay,
  funktionSwitcher,
  children,
}: {
  /** The bar's heading once the seats are read, a `TeamShellHeading`. */
  heading?: React.ReactNode;
  /** The entries the seats at the address reach; every entry where none stands, which no seat narrows. */
  entries?: React.ReactNode;
  saisonMetadataDisplay: React.ReactNode;
  funktionSwitcher: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <AppShell
      structure={TEAM_SIDEMENU_STRUCTURE}
      entries={entries}
      heading={heading}
      linkPrefix={teamPrefixOf}
      // The season is the address's own segment, so no link carries it a second time as a query.
      keepsSaisonQuery={false}
      iconDictionary={TEAM_SIDEMENU_ICONS}
      saisonMetadataDisplay={saisonMetadataDisplay}
      funktionSwitcher={funktionSwitcher}
      fallbackTitle={TEAM_SHELL_FALLBACK.label}
      fallbackHint={TEAM_SHELL_FALLBACK.hint}
      kontoHref={KONTO_HREF}
      onSignOut={signOut}>
      {children}
    </AppShell>
  );
}

/**
 * The bar over an address the person holds no seat on heads the forbidden panel by the refusal, at any
 * page there: the hint says why the page is refused rather than missing.
 */
export function TeamShellHeading({ isRefused }: { isRefused: boolean }) {
  return (
    <ShellHeading
      structure={isRefused ? [] : TEAM_SIDEMENU_STRUCTURE}
      linkPrefix={teamPrefixOf}
      fallback={isRefused ? TEAM_SHELL_REFUSAL : TEAM_SHELL_FALLBACK}
      kontoHref={KONTO_HREF}
    />
  );
}

/** The team area's entries, which a layout builds from the seats at the address: only this area's icons draw them. */
export function TeamSidemenuEntries({ structure }: { structure: SidemenuStructure<TeamIconName> }) {
  return (
    <SidemenuEntries
      structure={structure}
      iconDictionary={TEAM_SIDEMENU_ICONS}
    />
  );
}
